const express = require("express")
const { body, validationResult } = require("express-validator")
const { requireAuth, requireRole, requireDepartmentAccess } = require("../middleware/auth")
const User = require("../models/User")
const Department = require("../models/Department")
const Review = require("../models/Review")
const Question = require("../models/Question")

const router = express.Router()

// Apply HOD role requirement to all routes
router.use(requireAuth, requireRole(["hod"]), requireDepartmentAccess)

// HOD Dashboard
router.get("/dashboard", async (req, res) => {
  try {
    console.log("Loading HOD dashboard...") // Debug log
    console.log("HOD Department:", req.userDepartment.name, "ID:", req.userDepartment._id)

    const currentHODId = req.session.user._id
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id name")

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments of assigned departments where this HOD is also assigned
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      const assignedSubDepts = await Department.find({
        _id: { $in: subDeptIds },
        hods: currentHODId,
        isActive: true,
      }).select("_id")

      allAssignedDepartmentIds.push(...assignedSubDepts.map((d) => d._id))
    }

    // Remove duplicates
    allAssignedDepartmentIds = [...new Set(allAssignedDepartmentIds.map((id) => id.toString()))]

    // Get all employees in assigned departments
    const departmentEmployees = await User.find({
      department: { $in: allAssignedDepartmentIds },
      role: "employee",
      isActive: true,
    })

    const departmentHODs = await User.find({
      department: { $in: allAssignedDepartmentIds },
      role: "hod",
      isActive: true,
      _id: { $ne: req.session.user._id }, // Exclude self
    })

    // Get all HODs from other departments for cross-department reviews
    const otherHODs = await User.find({
      role: "hod",
      isActive: true,
      _id: { $ne: req.session.user._id },
      department: { $nin: allAssignedDepartmentIds },
    }).populate("department", "name")

    const currentQuarter = getCurrentQuarter()

    // Current quarter reviews for assigned departments only (exclude self assessments)
    const currentQuarterReviews = await Review.countDocuments({
      department: { $in: allAssignedDepartmentIds },
      quarter: currentQuarter,
      isSelfAssessment: { $ne: true },
    })

    // Average rating for current quarter in assigned departments only (exclude self assessments)
    let avgRating = 0
    try {
      const avgRatingResult = await Review.aggregate([
        {
          $match: {
            department: { $in: allAssignedDepartmentIds },
            quarter: currentQuarter,
            isSelfAssessment: { $ne: true },
          },
        },
        {
          $addFields: {
            effectiveScore: {
              $cond: {
                if: { $gt: ["$overallScore", 0] },
                then: "$overallScore",
                else: { $ifNull: ["$score", 0] },
              },
            },
          },
        },
        {
          $group: {
            _id: "$employee",
            avgScore: { $avg: "$effectiveScore" },
          },
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$avgScore" },
          },
        },
      ])
      avgRating = avgRatingResult.length > 0 ? avgRatingResult[0].avgRating.toFixed(2) : 0
    } catch (avgError) {
      console.log("Error calculating average rating:", avgError.message)
      avgRating = 0
    }

    // Employees pending review this quarter
    const reviewedEmployeeIds = await Review.find({
      reviewer: req.session.user._id,
      quarter: currentQuarter,
      isSelfAssessment: { $ne: true },
    }).distinct("employee")

    const pendingEmployeeReviews = departmentEmployees.filter(
      (emp) => !reviewedEmployeeIds.some((id) => id.toString() === emp._id.toString()),
    )

    const pendingHODReviews = [...departmentHODs, ...otherHODs].filter(
      (hod) => !reviewedEmployeeIds.some((id) => id.toString() === hod._id.toString()),
    )

    // Recent reviews (exclude self assessments)
    const recentReviews = await Review.find({
      reviewer: req.session.user._id,
      isSelfAssessment: { $ne: true },
    })
      .populate("employee", "name employeeId")
      .sort({ createdAt: -1 })
      .limit(5)

    console.log("HOD dashboard data loaded successfully") // Debug log

    res.render("hod/dashboard", {
      department: req.userDepartment,
      totalEmployees: departmentEmployees.length,
      totalHODs: departmentHODs.length + otherHODs.length,
      currentQuarterReviews,
      avgRating,
      pendingEmployeeReviews: pendingEmployeeReviews.length,
      pendingHODReviews: pendingHODReviews.length,
      recentReviews,
      currentQuarter,
    })
  } catch (error) {
    console.error("HOD dashboard error:", error)
    res.status(500).render("error", {
      message: "Error loading dashboard: " + error.message,
      user: req.session.user || null,
    })
  }
})

// Review Employees and HODs
router.get("/reviews", async (req, res) => {
  try {
    const currentHODId = req.session.user._id

    // Get departments where this HOD is specifically assigned
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id name")

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments of assigned departments (only those assigned to this HOD)
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      const assignedSubDepts = await Department.find({
        _id: { $in: subDeptIds },
        hods: currentHODId,
        isActive: true,
      }).select("_id")

      allAssignedDepartmentIds.push(...assignedSubDepts.map((d) => d._id))
    }

    // Remove duplicates
    allAssignedDepartmentIds = [...new Set(allAssignedDepartmentIds.map((id) => id.toString()))]

    // Get department employees (only from departments this HOD is assigned to)
    const departmentEmployees = await User.find({
      department: { $in: allAssignedDepartmentIds },
      role: "employee",
      isActive: true,
    }).populate("department", "name parentDepartment")

    // Get department HODs (only from departments this HOD is assigned to, excluding self)
    const departmentHODs = await User.find({
      department: { $in: allAssignedDepartmentIds },
      role: "hod",
      isActive: true,
      _id: { $ne: req.session.user._id },
    }).populate("department", "name parentDepartment")

    // Get all HODs from other departments (departments this HOD is NOT assigned to)
    const otherHODs = await User.find({
      role: "hod",
      isActive: true,
      _id: { $ne: req.session.user._id },
      department: { $nin: allAssignedDepartmentIds },
    }).populate("department", "name parentDepartment")

    const currentQuarter = getCurrentQuarter()

    // Get employees/HODs already reviewed by this reviewer this quarter (exclude self)
    const reviewedIds = await Review.find({
      reviewer: req.session.user._id,
      quarter: currentQuarter,
      isSelfAssessment: { $ne: true },
    }).distinct("employee")

    // Filter out already reviewed people
    const employeesToReview = departmentEmployees.filter(
      (emp) => !reviewedIds.some((id) => id.toString() === emp._id.toString()),
    )

    const departmentHODsToReview = departmentHODs.filter(
      (hod) => !reviewedIds.some((id) => id.toString() === hod._id.toString()),
    )

    const otherHODsToReview = otherHODs.filter((hod) => !reviewedIds.some((id) => id.toString() === hod._id.toString()))

    // Get review questions for departments this HOD is assigned to, plus global (assessmentType=review)
    let questions = []
    try {
      questions = await Question.find({
        assessmentType: "review",
        $or: [
          { department: null }, // Global questions
          { department: { $in: allAssignedDepartmentIds } }, // Questions for assigned departments
        ],
        isActive: true,
      })
        .populate("department", "name parentDepartment")
        .sort({ category: 1, createdAt: 1 })

      console.log(`Found ${questions.length} review questions for assigned departments`)
    } catch (questionError) {
      console.log("Question model not found, using empty questions array")
      questions = []
    }

    // Get all reviews by this reviewer (exclude self assessments)
    const allReviews = await Review.find({ reviewer: req.session.user._id, isSelfAssessment: { $ne: true } })
      .populate("employee", "name employeeId role")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    res.render("hod/reviews", {
      employeesToReview,
      departmentHODsToReview,
      otherHODsToReview,
      questions,
      allReviews,
      currentQuarter,
      department: req.userDepartment,
    })
  } catch (error) {
    console.error("HOD reviews error:", error)
    res.status(500).render("error", {
      message: "Error loading reviews: " + error.message,
      user: req.session.user || null,
    })
  }
})

// Submit Review - POST route
router.post("/reviews", async (req, res) => {
  try {
    const { employee, answers, comments } = req.body

    if (!employee || !comments || comments.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Employee ID and detailed comments (min 10 chars) are required",
      })
    }

    const currentQuarter = getCurrentQuarter()

    // Get employee details and verify department access
    const employeeDoc = await User.findById(employee).populate("department", "_id name")
    if (!employeeDoc) {
      return res.status(404).json({ success: false, message: "Employee not found" })
    }

    // Verify HOD has access to this employee's department
    const currentHODId = req.session.user._id
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id")

    const assignedDepartmentIds = assignedDepartments.map((d) => d._id)
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      const assignedSubDepts = await Department.find({
        _id: { $in: subDeptIds },
        hods: currentHODId,
        isActive: true,
      }).select("_id")
      allAssignedDepartmentIds.push(...assignedSubDepts.map((d) => d._id))
    }
    allAssignedDepartmentIds = [...new Set(allAssignedDepartmentIds.map((id) => id.toString()))]

    const empDeptId = employeeDoc.department?._id?.toString()
    const hasAccess = !empDeptId || allAssignedDepartmentIds.includes(empDeptId) || employeeDoc.role === "hod"

    if (!hasAccess) {
      return res.status(403).json({ success: false, message: "Not authorized to review this employee" })
    }

    // Check if already reviewed this quarter
    const existingReview = await Review.findOne({
      employee,
      reviewer: req.session.user._id,
      quarter: currentQuarter,
      isSelfAssessment: { $ne: true },
    })

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this person for this quarter",
      })
    }

    // Calculate overall score from answers
    let overallScore = null
    if (answers && Array.isArray(answers) && answers.length > 0) {
      const totalRating = answers.reduce((sum, answer) => sum + (answer.rating || 0), 0)
      overallScore = Math.round((totalRating / answers.length) * 100) / 100
    }

    // Create review
    const reviewData = {
      employee,
      reviewer: req.session.user._id,
      department: employeeDoc.department?._id || null,
      quarter: currentQuarter,
      isSelfAssessment: false,
      answers: answers || [],
      overallScore,
      comments: comments.trim(),
    }

    await Review.create(reviewData)

    res.json({ success: true, message: "Review submitted successfully" })
  } catch (error) {
    console.error("Submit review error:", error)
    if (error.message.includes("already reviewed")) {
      res.status(400).json({ success: false, message: error.message })
    } else {
      res.status(500).json({ success: false, message: "Error submitting review" })
    }
  }
})

// GET: View an employee's self-assessment for current (or specified) quarter
router.get("/self-assessment/:employeeId", async (req, res) => {
  try {
    const currentHODId = req.session.user._id
    const { employeeId } = req.params
    const quarter = req.query.quarter || getCurrentQuarter()

    // Check department access: employee must be within HOD's assigned departments (including sub-departments where assigned)
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id")

    const assignedDepartmentIds = assignedDepartments.map((d) => d._id)
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      const assignedSubDepts = await Department.find({
        _id: { $in: subDeptIds },
        hods: currentHODId,
        isActive: true,
      }).select("_id")
      allAssignedDepartmentIds.push(...assignedSubDepts.map((d) => d._id))
    }
    allAssignedDepartmentIds = [...new Set(allAssignedDepartmentIds.map((id) => id.toString()))]

    const employee = await User.findById(employeeId).populate("department", "_id name")
    if (!employee || !employee.department) {
      return res.status(404).json({ success: false, message: "Employee or department not found" })
    }

    const empDeptId = employee.department._id.toString()
    if (!allAssignedDepartmentIds.includes(empDeptId)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this self assessment" })
    }

    // Fetch self assessment
    const selfAssessment = await Review.findOne({
      employee: employeeId,
      reviewer: employeeId,
      isSelfAssessment: true,
      quarter,
    })
      .populate("answers.question", "text inputType options category")
      .exec()

    if (!selfAssessment) {
      return res.status(404).json({ success: false, message: "Self assessment not found for this quarter" })
    }

    return res.json({
      success: true,
      data: {
        employee: { name: employee.name, employeeId: employee.employeeId, department: employee.department.name },
        quarter: selfAssessment.quarter,
        comments: selfAssessment.comments,
        answers: (selfAssessment.answers || []).map((a) => ({
          questionId: a.question?._id,
          questionText: a.question?.text,
          inputType: a.question?.inputType,
          rating: a.rating || null,
          responseOption: a.responseOption || null,
          responseText: a.responseText || null,
          category: a.question?.category,
        })),
        submittedAt: selfAssessment.updatedAt || selfAssessment.createdAt,
      },
    })
  } catch (error) {
    console.error("HOD view self assessment error:", error)
    return res.status(500).json({ success: false, message: "Error fetching self assessment: " + error.message })
  }
})

// Export CSV - Reviews for HOD's departments
router.get("/export/reviews", async (req, res) => {
  try {
    const currentHODId = req.session.user._id
    const { quarter } = req.query

    // Get departments assigned to this HOD
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id")

    const assignedDepartmentIds = assignedDepartments.map((d) => d._id)
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      const assignedSubDepts = await Department.find({
        _id: { $in: subDeptIds },
        hods: currentHODId,
        isActive: true,
      }).select("_id")
      allAssignedDepartmentIds.push(...assignedSubDepts.map((d) => d._id))
    }
    allAssignedDepartmentIds = [...new Set(allAssignedDepartmentIds.map((id) => id.toString()))]

    // Build query for reviews in assigned departments
    const query = {
      department: { $in: allAssignedDepartmentIds },
      isSelfAssessment: { $ne: true },
    }
    if (quarter) query.quarter = quarter

    // Get reviews with populated data
    const reviews = await Review.find(query)
      .populate("employee", "name employeeId email")
      .populate("reviewer", "name employeeId")
      .populate("department", "name")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    // Generate CSV content
    let csvContent = "Employee Name,Employee ID,Email,Department,Quarter,Overall Score,Reviewer,Review Date,Comments\n"

    reviews.forEach((review) => {
      const employeeName = review.employee ? review.employee.name : "Unknown"
      const employeeId = review.employee ? review.employee.employeeId : "Unknown"
      const email = review.employee ? review.employee.email : "Unknown"
      const department = review.department ? review.department.name : "Unknown"
      const score = review.overallScore || review.score || "N/A"
      const reviewer = review.reviewer ? review.reviewer.name : "Unknown"
      const reviewDate = new Date(review.reviewDate).toLocaleDateString()
      const comments = review.comments ? review.comments.replace(/"/g, '""').replace(/\n/g, " ") : ""

      csvContent += `"${employeeName}","${employeeId}","${email}","${department}","${review.quarter}","${score}","${reviewer}","${reviewDate}","${comments}"\n`
    })

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="hod_reviews_export_${new Date().toISOString().split("T")[0]}.csv"`,
    )
    res.send(csvContent)
  } catch (error) {
    console.error("HOD export reviews error:", error)
    res.status(500).render("error", { message: "Error exporting reviews" })
  }
})

// Export CSV - Performance Summary for HOD's departments
router.get("/export/performance", async (req, res) => {
  try {
    const currentHODId = req.session.user._id
    const { quarter } = req.query
    const currentQuarter = quarter || getCurrentQuarter()

    // Get departments assigned to this HOD
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id")

    const assignedDepartmentIds = assignedDepartments.map((d) => d._id)
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      const assignedSubDepts = await Department.find({
        _id: { $in: subDeptIds },
        hods: currentHODId,
        isActive: true,
      }).select("_id")
      allAssignedDepartmentIds.push(...assignedSubDepts.map((d) => d._id))
    }
    allAssignedDepartmentIds = [...new Set(allAssignedDepartmentIds.map((id) => id.toString()))]

    // Get employees in assigned departments
    const employees = await User.find({
      department: { $in: allAssignedDepartmentIds },
      role: { $in: ["employee", "hod"] },
      isActive: true,
    }).populate("department", "name")

    // Get reviews for the specified quarter in assigned departments
    const reviews = await Review.find({
      quarter: currentQuarter,
      department: { $in: allAssignedDepartmentIds },
      isSelfAssessment: { $ne: true },
    })
      .populate("employee", "name employeeId email")
      .populate("department", "name")

    // Create performance summary
    const performanceData = []

    for (const employee of employees) {
      const employeeReviews = reviews.filter((r) => r.employee && r.employee._id.toString() === employee._id.toString())

      let avgScore = 0
      const reviewCount = employeeReviews.length

      if (reviewCount > 0) {
        const totalScore = employeeReviews.reduce((sum, review) => {
          return sum + (review.overallScore || review.score || 0)
        }, 0)
        avgScore = (totalScore / reviewCount).toFixed(2)
      }

      const performanceLevel = getPerformanceLevel(Number.parseFloat(avgScore))

      performanceData.push({
        name: employee.name,
        employeeId: employee.employeeId,
        email: employee.email,
        department: employee.department ? employee.department.name : "Not Assigned",
        role: employee.role.toUpperCase(),
        avgScore: avgScore || "N/A",
        reviewCount,
        performanceLevel,
        quarter: currentQuarter,
      })
    }

    // Generate CSV content
    let csvContent =
      "Employee Name,Employee ID,Email,Department,Role,Average Score,Review Count,Performance Level,Quarter\n"

    performanceData.forEach((emp) => {
      csvContent += `"${emp.name}","${emp.employeeId}","${emp.email}","${emp.department}","${emp.role}","${emp.avgScore}","${emp.reviewCount}","${emp.performanceLevel}","${emp.quarter}"\n`
    })

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="hod_performance_summary_${currentQuarter.replace(" ", "_")}_${new Date().toISOString().split("T")[0]}.csv"`,
    )
    res.send(csvContent)
  } catch (error) {
    console.error("HOD export performance error:", error)
    res.status(500).render("error", { message: "Error exporting performance data" })
  }
})

// Helper function to get all department IDs including sub-departments
async function getAllDepartmentIds(departmentId) {
  try {
    const allIds = [departmentId]
    const subDepartments = await Department.find({
      parentDepartment: departmentId,
      isActive: true,
    })
    for (const subDept of subDepartments) {
      allIds.push(subDept._id)
      const subSubIds = await getAllDepartmentIds(subDept._id)
      allIds.push(...subSubIds.slice(1))
    }
    return allIds
  } catch (error) {
    console.log("Error getting department IDs:", error.message)
    return [departmentId]
  }
}

// Helper function to get current quarter
function getCurrentQuarter() {
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()
  let quarter

  if (month <= 3) quarter = "Q1"
  else if (month <= 6) quarter = "Q2"
  else if (month <= 9) quarter = "Q3"
  else quarter = "Q4"

  return `${quarter} ${year}`
}

// Helper function to get performance level
function getPerformanceLevel(score) {
  if (score >= 6) return "Outstanding Performance"
  if (score >= 5) return "Superior Performance"
  if (score >= 4) return "Effective Performance"
  if (score >= 3) return "Standard Performance"
  if (score >= 2) return "Developing Performance"
  return "Ineffective Performance"
}

module.exports = router
