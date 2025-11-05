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

    console.log(
      `HOD ${req.session.user.name} is assigned to ${assignedDepartments.length} departments:`,
      assignedDepartments.map((d) => d.name),
    )

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments of assigned departments where this HOD is also assigned
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      // Only add sub-departments where this HOD is also assigned
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

    const currentMonth = getCurrentMonth()

    // Current month reviews for assigned departments only
    const currentMonthReviews = await Review.countDocuments({
      department: { $in: allAssignedDepartmentIds },
      month: currentMonth,
    })

    // Average rating for current month in assigned departments only
    let avgRating = 0
    try {
      const avgRatingResult = await Review.aggregate([
        { $match: { department: { $in: allAssignedDepartmentIds }, month: currentMonth } },
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

    // Employees pending review this month
    const reviewedEmployeeIds = await Review.find({
      reviewer: req.session.user._id,
      month: currentMonth,
    }).distinct("employee")

    const pendingEmployeeReviews = departmentEmployees.filter(
      (emp) => !reviewedEmployeeIds.some((id) => id.toString() === emp._id.toString()),
    )

    const pendingHODReviews = [...departmentHODs, ...otherHODs].filter(
      (hod) => !reviewedEmployeeIds.some((id) => id.toString() === hod._id.toString()),
    )

    // Recent reviews
    const recentReviews = await Review.find({
      reviewer: req.session.user._id,
    })
      .populate("employee", "name employeeId")
      .sort({ createdAt: -1 })
      .limit(5)

    console.log("HOD dashboard data loaded successfully") // Debug log

    res.render("hod/dashboard", {
      department: req.userDepartment,
      totalEmployees: departmentEmployees.length,
      totalHODs: departmentHODs.length + otherHODs.length,
      currentQuarterReviews: currentMonthReviews, // Changed currentMonthReviews to currentQuarterReviews to match template variable name
      avgRating,
      pendingEmployeeReviews: pendingEmployeeReviews.length,
      pendingHODReviews: pendingHODReviews.length,
      recentReviews,
      currentMonth,
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

    console.log(
      `HOD ${req.session.user.name} is assigned to ${assignedDepartments.length} departments:`,
      assignedDepartments.map((d) => d.name),
    )

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments of assigned departments
    let allAssignedDepartmentIds = [...assignedDepartmentIds]
    for (const deptId of assignedDepartmentIds) {
      const subDeptIds = await getAllDepartmentIds(deptId)
      // Only add sub-departments where this HOD is also assigned
      const assignedSubDepts = await Department.find({
        _id: { $in: subDeptIds },
        hods: currentHODId,
        isActive: true,
      }).select("_id")

      allAssignedDepartmentIds.push(...assignedSubDepts.map((d) => d._id))
    }

    // Remove duplicates
    allAssignedDepartmentIds = [...new Set(allAssignedDepartmentIds.map((id) => id.toString()))]

    console.log(`Total departments this HOD can review: ${allAssignedDepartmentIds.length}`)

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

    const currentMonth = getCurrentMonth()

    // Get employees/HODs already reviewed by this reviewer this month
    const reviewedIds = await Review.find({
      reviewer: req.session.user._id,
      month: currentMonth,
    }).distinct("employee")

    // Filter out already reviewed people
    const employeesToReview = departmentEmployees.filter(
      (emp) => !reviewedIds.some((id) => id.toString() === emp._id.toString()),
    )

    const departmentHODsToReview = departmentHODs.filter(
      (hod) => !reviewedIds.some((id) => id.toString() === hod._id.toString()),
    )

    const otherHODsToReview = otherHODs.filter((hod) => !reviewedIds.some((id) => id.toString() === hod._id.toString()))

    // Get questions for departments this HOD is assigned to, plus global questions
    let questions = []
    try {
      questions = await Question.find({
        $or: [
          { department: null }, // Global questions
          { department: { $in: allAssignedDepartmentIds } }, // Questions for assigned departments
        ],
        isActive: true,
      })
        .populate("department", "name parentDepartment")
        .sort({ category: 1, createdAt: 1 })

      console.log(`Found ${questions.length} questions for assigned departments`)
    } catch (questionError) {
      console.log("Question model not found, using empty questions array")
      questions = []
    }

    // Get all reviews by this reviewer
    const allReviews = await Review.find({ reviewer: req.session.user._id })
      .populate("employee", "name employeeId role")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    res.render("hod/reviews", {
      employeesToReview,
      departmentHODsToReview,
      otherHODsToReview,
      questions,
      allReviews,
      currentMonth,
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

// Submit Review - Updated for 6-point scale
router.post("/reviews", async (req, res) => {
  try {
    const { employee, answers, comments } = req.body
    const currentMonth = getCurrentMonth()
    const reviewerId = req.session.user._id

    console.log("=== REVIEW SUBMISSION DEBUG ===")
    console.log("Current reviewer ID:", reviewerId)
    console.log("Current reviewer name:", req.session.user.name)
    console.log("Employee to review:", employee)
    console.log("Current month:", currentMonth)

    // Validate input
    if (!employee || !comments || !comments.trim()) {
      console.log("❌ Validation failed: Missing employee or comments")
      return res.status(400).json({
        success: false,
        message: "Employee and comments are required",
      })
    }

    // Verify employee exists and can be reviewed by this HOD
    const employeeDoc = await User.findOne({
      _id: employee,
      isActive: true,
    }).populate("department")

    if (!employeeDoc) {
      console.log("❌ Employee not found:", employee)
      return res.status(400).json({
        success: false,
        message: "Employee not found",
      })
    }

    console.log("✅ Employee found:", {
      name: employeeDoc.name,
      id: employeeDoc._id,
      department: employeeDoc.department ? employeeDoc.department.name : "No department",
    })

    // Verify this HOD can review this employee (department access check)
    const currentHODId = req.session.user._id
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id")

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments where this HOD is assigned
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

    // Check if employee's department is in HOD's assigned departments or if it's a cross-department HOD review
    const employeeDepartmentId = employeeDoc.department._id.toString()
    const canReviewEmployee = allAssignedDepartmentIds.includes(employeeDepartmentId) || employeeDoc.role === "hod" // HODs can review other HODs cross-department

    if (!canReviewEmployee) {
      console.log("❌ HOD not authorized to review this employee's department")
      return res.status(403).json({
        success: false,
        message: "You are not authorized to review employees from this department",
      })
    }

    console.log("✅ HOD authorized to review this employee")

    // Check if review already exists for this SPECIFIC reviewer-employee-month combination
    console.log("🔍 Checking for existing review with criteria:")
    console.log("  - Employee ID:", employee)
    console.log("  - Reviewer ID:", reviewerId)
    console.log("  - Month:", currentMonth)

    const existingReview = await Review.findOne({
      employee: employee,
      reviewer: reviewerId,
      month: currentMonth,
    })

    console.log("🔍 Existing review query result:", existingReview ? "FOUND" : "NOT FOUND")

    if (existingReview) {
      console.log("❌ Review already exists:")
      console.log("  - Review ID:", existingReview._id)
      console.log("  - Employee:", existingReview.employee)
      console.log("  - Reviewer:", existingReview.reviewer)
      console.log("  - Month:", existingReview.month)

      return res.status(400).json({
        success: false,
        message: "You have already reviewed this person for this month",
      })
    }

    // Handle both new question-based and legacy review systems
    let parsedAnswers = []
    let overallScore = 3 // Default score (middle of 6-point scale)

    if (answers) {
      try {
        parsedAnswers = typeof answers === "string" ? JSON.parse(answers) : answers
        if (Array.isArray(parsedAnswers) && parsedAnswers.length > 0) {
          // Calculate overall score from answers (6-point scale)
          const totalRating = parsedAnswers.reduce((sum, answer) => sum + Number.parseInt(answer.rating), 0)
          overallScore = totalRating / parsedAnswers.length
        }
      } catch (error) {
        console.log("⚠️ Error parsing answers, using legacy system:", error.message)
        parsedAnswers = []
      }
    }

    // Create review data
    const reviewData = {
      employee: employee,
      reviewer: reviewerId,
      department: employeeDoc.department._id,
      month: currentMonth,
      comments: comments.trim(),
    }

    // Add question-based data if available
    if (parsedAnswers.length > 0) {
      reviewData.answers = parsedAnswers
      reviewData.overallScore = Math.round(overallScore * 100) / 100
    } else {
      // Legacy system - use a default score
      reviewData.score = overallScore
    }

    console.log("📝 Creating review with data:")
    console.log("  - Employee:", reviewData.employee)
    console.log("  - Reviewer:", reviewData.reviewer)
    console.log("  - Department:", reviewData.department)
    console.log("  - Month:", reviewData.month)
    console.log("  - Has Answers:", reviewData.answers ? reviewData.answers.length : 0)
    console.log("  - Overall Score:", reviewData.overallScore)
    console.log("  - Legacy Score:", reviewData.score)

    // Create review
    const newReview = await Review.create(reviewData)
    console.log("✅ Review created successfully with ID:", newReview._id)

    res.json({ success: true, message: "Review submitted successfully" })
  } catch (error) {
    console.error("❌ Submit review error:", error)

    // Handle specific MongoDB errors
    if (error.code === 11000) {
      console.log("❌ Duplicate key error:", error.keyPattern)
      console.log("❌ Duplicate key value:", error.keyValue)
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this person for this month",
      })
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      console.log("❌ Validation error:", error.message)
      return res.status(400).json({
        success: false,
        message: "Validation error: " + error.message,
      })
    }

    res.status(500).json({
      success: false,
      message: "Error submitting review: " + error.message,
    })
  }
})

// Export CSV - Department Reviews
router.get("/export/reviews", async (req, res) => {
  try {
    const { month } = req.query
    const currentMonth = month || getCurrentMonth()
    const currentHODId = req.session.user._id

    // Get departments where this HOD is assigned
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id name")

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments where this HOD is assigned
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

    // Get reviews for assigned departments
    const reviews = await Review.find({
      month: currentMonth,
      $or: [
        { department: { $in: allAssignedDepartmentIds } }, // Department reviews
        { reviewer: currentHODId }, // Reviews by this HOD
      ],
    })
      .populate("employee", "name employeeId email role")
      .populate("reviewer", "name employeeId")
      .populate("department", "name")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    // Generate CSV content
    let csvContent = "Employee Name,Employee ID,Email,Role,Department,Overall Score,Reviewer,Review Date,Comments\n"

    reviews.forEach((review) => {
      const employeeName = review.employee ? review.employee.name : "Unknown"
      const employeeId = review.employee ? review.employee.employeeId : "Unknown"
      const email = review.employee ? review.employee.email : "Unknown"
      const role = review.employee ? review.employee.role.toUpperCase() : "Unknown"
      const department = review.department ? review.department.name : "Unknown"
      const score = review.overallScore || review.score || "N/A"
      const reviewer = review.reviewer ? review.reviewer.name : "Unknown"
      const reviewDate = new Date(review.reviewDate).toLocaleDateString()
      const comments = review.comments ? review.comments.replace(/"/g, '""').replace(/\n/g, " ") : ""

      csvContent += `"${employeeName}","${employeeId}","${email}","${role}","${department}","${score}","${reviewer}","${reviewDate}","${comments}"\n`
    })

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="department_reviews_${currentMonth.replace(" ", "_")}_${new Date().toISOString().split("T")[0]}.csv"`,
    )
    res.send(csvContent)
  } catch (error) {
    console.error("Export department reviews error:", error)
    res.status(500).render("error", { message: "Error exporting reviews" })
  }
})

// Export CSV - Department Performance Summary
router.get("/export/performance", async (req, res) => {
  try {
    const { month } = req.query
    const currentMonth = month || getCurrentMonth()
    const currentHODId = req.session.user._id

    // Get departments where this HOD is assigned
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id name")

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments where this HOD is assigned
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

    // Get employees from assigned departments
    const employees = await User.find({
      department: { $in: allAssignedDepartmentIds },
      role: { $in: ["employee", "hod"] },
      isActive: true,
    }).populate("department", "name")

    // Get reviews for the specified month
    const reviews = await Review.find({
      month: currentMonth,
      department: { $in: allAssignedDepartmentIds },
    }).populate("employee", "name employeeId email")

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
        month: currentMonth,
      })
    }

    // Generate CSV content
    let csvContent =
      "Employee Name,Employee ID,Email,Department,Role,Average Score,Review Count,Performance Level,Month\n"

    performanceData.forEach((emp) => {
      csvContent += `"${emp.name}","${emp.employeeId}","${emp.email}","${emp.department}","${emp.role}","${emp.avgScore}","${emp.reviewCount}","${emp.performanceLevel}","${emp.month}"\n`
    })

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="department_performance_${currentMonth.replace(" ", "_")}_${new Date().toISOString().split("T")[0]}.csv"`,
    )
    res.send(csvContent)
  } catch (error) {
    console.error("Export department performance error:", error)
    res.status(500).render("error", { message: "Error exporting performance data" })
  }
})

// Debug route to check current user session
router.get("/debug/session", (req, res) => {
  res.json({
    user: req.session.user,
    department: req.userDepartment,
  })
})

// Helper function to get all department IDs including sub-departments
async function getAllDepartmentIds(departmentId) {
  try {
    const allIds = [departmentId]
    console.log(`Getting all department IDs for department: ${departmentId}`)

    // Get all sub-departments
    const subDepartments = await Department.find({
      parentDepartment: departmentId,
      isActive: true,
    })

    console.log(`Found ${subDepartments.length} sub-departments`)

    for (const subDept of subDepartments) {
      console.log(`Adding sub-department: ${subDept.name} (${subDept._id})`)
      allIds.push(subDept._id)
      // Recursively get sub-departments of sub-departments
      const subSubIds = await getAllDepartmentIds(subDept._id)
      allIds.push(...subSubIds.slice(1)) // Remove the first element as it's already included
    }

    console.log(`Final department IDs: ${allIds.length} departments`)
    return allIds
  } catch (error) {
    console.log("Error getting department IDs:", error.message)
    return [departmentId]
  }
}

// Helper function to get current month
function getCurrentMonth() {
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()
  return `M${month} ${year}`
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
