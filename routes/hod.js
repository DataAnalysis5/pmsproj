const express = require("express")
const bcrypt = require("bcryptjs")
const { body, validationResult } = require("express-validator")
const { requireAuth, requireRole, requireDepartmentAccess } = require("../middleware/auth")
const User = require("../models/User")
const Department = require("../models/Department")
const Review = require("../models/Review")
const Question = require("../models/Question")
const SelfAssessment = require("../models/SelfAssessment")

const router = express.Router()

// Apply HOD role requirement to all routes
router.use(requireAuth, requireRole(["hod"]), requireDepartmentAccess)

// HOD Change Password
router.get("/change-password", (req, res) => {
  try {
    res.render("hod/change-password", {
      hod: req.session.user,
      error: null,
      success: null,
    })
  } catch (error) {
    console.error("Change password form error:", error)
    res.status(500).render("error", {
      message: "Error loading change password form",
      user: req.session.user || null,
    })
  }
})

router.post(
  "/change-password",
  [
    body("currentPassword").notEmpty().withMessage("Current password is required"),
    body("newPassword").isLength({ min: 6 }).withMessage("New password must be at least 6 characters"),
    body("confirmPassword").custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error("Passwords do not match")
      }
      return true
    }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.render("hod/change-password", {
          hod: req.session.user,
          error: errors.array()[0].msg,
          success: null,
        })
      }

      const { currentPassword, newPassword } = req.body
      const userId = req.session.user._id

      // Get user from database
      const user = await User.findById(userId)
      if (!user) {
        return res.render("hod/change-password", {
          hod: req.session.user,
          error: "User not found",
          success: null,
        })
      }

      // Verify current password
      const isMatch = await bcrypt.compare(currentPassword, user.password)
      if (!isMatch) {
        return res.render("hod/change-password", {
          hod: req.session.user,
          error: "Current password is incorrect",
          success: null,
        })
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12)

      // Update password in database
      await User.findByIdAndUpdate(userId, { password: hashedPassword })

      console.log("Password changed successfully for HOD:", user.name)

      res.render("hod/change-password", {
        hod: req.session.user,
        error: null,
        success: "Password changed successfully!",
      })
    } catch (error) {
      console.error("Change password error:", error)
      res.render("hod/change-password", {
        hod: req.session.user,
        error: "Error changing password: " + error.message,
        success: null,
      })
    }
  },
)

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

// HOD Self-Assessment Form
router.get("/self-assessment", async (req, res) => {
  try {
    const hodId = req.session.user._id
    const selectedMonth = req.query.month || getCurrentMonth()

    // Get HOD's department
    const hod = await User.findById(hodId).populate("department")

    if (!hod || !hod.department) {
      return res.render("hod/self-assessment", {
        hod: req.session.user,
        questions: [],
        selectedMonth,
        availableMonths: [],
        error: "You are not assigned to any department",
      })
    }

    const availableMonths = []
    const today = new Date()
    for (let i = 0; i < 12; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const month = date.getMonth() + 1
      const year = date.getFullYear()
      availableMonths.push(`M${month} ${year}`)
    }

    // Get self-assessment questions for this HOD's department
    const questions = await Question.find({
      questionType: "self-assessment",
      isActive: true,
      $or: [
        { department: null }, // Global questions
        { department: hod.department._id }, // Questions for HOD's department
      ],
    })
      .populate("department", "name")
      .sort({ category: 1, createdAt: 1 })

    // Check if already submitted for selected month
    const existingAssessment = await SelfAssessment.findOne({
      employee: hodId,
      month: selectedMonth,
    })

    res.render("hod/self-assessment", {
      hod: req.session.user,
      questions,
      selectedMonth,
      availableMonths,
      existingAssessment: existingAssessment ? existingAssessment : null,
      success: null,
      error: null,
    })
  } catch (error) {
    console.error("HOD self-assessment form error:", error)
    res.status(500).render("error", {
      message: "Error loading self-assessment form",
      user: req.session.user || null,
    })
  }
})

// Submit HOD Self-Assessment
router.post("/self-assessment", async (req, res) => {
  try {
    const hodId = req.session.user._id
    const { month, answers } = req.body

    // Get HOD's department
    const hod = await User.findById(hodId).populate("department")

    if (!hod || !hod.department) {
      return res.status(400).json({ success: false, message: "HOD department not found" })
    }

    const existingAssessment = await SelfAssessment.findOne({
      employee: hodId,
      month: month,
    })

    // If assessment exists, check if all questions are editable
    if (existingAssessment) {
      // Get all questions and check if any are non-editable
      const questionsInAssessment = existingAssessment.answers.map((a) => a.question)
      const nonEditableQuestions = await Question.find({
        _id: { $in: questionsInAssessment },
        editableResponse: false,
      })

      if (nonEditableQuestions.length > 0) {
        return res.status(400).json({
          success: false,
          message: "You have already submitted your self-assessment for this month. Some responses cannot be edited.",
        })
      }

      // Update existing assessment with new answers
      existingAssessment.answers = []
      Object.keys(answers).forEach((questionId) => {
        const answer = answers[questionId]
        if (answer) {
          const processedAnswer = Array.isArray(answer) ? answer.join(", ") : answer
          existingAssessment.answers.push({
            question: questionId,
            answer: processedAnswer,
          })
        }
      })
      existingAssessment.submittedDate = new Date()

      await existingAssessment.save()
      console.log("Self-assessment updated for HOD:", hod.name, "Month:", month)
      return res.json({ success: true, message: "Self-assessment updated successfully!" })
    }

    // Process answers - handle both single values and arrays (for checkboxes)
    const processedAnswers = []

    Object.keys(answers).forEach((questionId) => {
      const answer = answers[questionId]
      if (answer) {
        // For checkbox answers that are arrays, join them; for others keep as is
        const processedAnswer = Array.isArray(answer) ? answer.join(", ") : answer
        processedAnswers.push({
          question: questionId,
          answer: processedAnswer,
        })
      }
    })

    const selfAssessment = new SelfAssessment({
      employee: hodId,
      department: hod.department._id,
      month: month,
      answers: processedAnswers,
    })

    await selfAssessment.save()
    console.log("Self-assessment submitted for HOD:", hod.name, "Month:", month)

    res.json({ success: true, message: "Self-assessment submitted successfully!" })
  } catch (error) {
    console.error("HOD self-assessment submission error:", error)
    res.status(500).json({ success: false, message: "Error submitting self-assessment: " + error.message })
  }
})

// Review Employees and HODs
router.get("/reviews", async (req, res) => {
  try {
    const currentHODId = req.session.user._id
    const selectedMonth = req.query.month || getCurrentMonth()

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

    const availableMonths = []
    const today = new Date()
    for (let i = 0; i < 12; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const month = date.getMonth() + 1
      const year = date.getFullYear()
      availableMonths.push(`M${month} ${year}`)
    }

    const reviewedIds = await Review.find({
      reviewer: req.session.user._id,
      month: selectedMonth,
    }).distinct("employee")

    // Filter out already reviewed people for selected month
    const employeesToReview = departmentEmployees.filter(
      (emp) => !reviewedIds.some((id) => id.toString() === emp._id.toString()),
    )

    const departmentHODsToReview = departmentHODs.filter(
      (hod) => !reviewedIds.some((id) => id.toString() === hod._id.toString()),
    )

    const otherHODsToReview = otherHODs.filter((hod) => !reviewedIds.some((id) => id.toString() === hod._id.toString()))

    // Get questions for each review type (employees, department HODs, other HODs)
    let employeeQuestions = []
    let departmentHODQuestions = []
    let otherHODQuestions = []
    try {
      // Questions for reviewing employees
      employeeQuestions = await Question.find({
        questionType: "review",
        reviewTargetType: "employees",
        $or: [
          { department: null }, // Global questions
          { department: { $in: allAssignedDepartmentIds } }, // Questions for assigned departments
        ],
        isActive: true,
      })
        .populate("department", "name parentDepartment")
        .sort({ category: 1, createdAt: 1 })

      // Questions for reviewing department HODs
      departmentHODQuestions = await Question.find({
        questionType: "review",
        reviewTargetType: "department-hods",
        $or: [
          { department: null }, // Global questions
          { department: { $in: allAssignedDepartmentIds } }, // Questions for assigned departments
        ],
        isActive: true,
      })
        .populate("department", "name parentDepartment")
        .sort({ category: 1, createdAt: 1 })

      // Questions for reviewing other HODs
      otherHODQuestions = await Question.find({
        questionType: "review",
        reviewTargetType: "other-hods",
        $or: [
          { department: null }, // Global questions
          { department: { $in: allAssignedDepartmentIds } }, // Questions for assigned departments
        ],
        isActive: true,
      })
        .populate("department", "name parentDepartment")
        .sort({ category: 1, createdAt: 1 })

      console.log(`Found ${employeeQuestions.length} employee questions, ${departmentHODQuestions.length} department HOD questions, ${otherHODQuestions.length} other HOD questions`)
    } catch (questionError) {
      console.log("Question retrieval error, using empty questions array:", questionError.message)
      employeeQuestions = []
      departmentHODQuestions = []
      otherHODQuestions = []
    }

    const questions = [...employeeQuestions, ...departmentHODQuestions, ...otherHODQuestions]

    // Get all reviews by this reviewer
    const allReviews = await Review.find({ reviewer: req.session.user._id })
      .populate("employee", "name employeeId role")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    // Parse the selected month to calculate the previous month
    const [monthStr, yearStr] = selectedMonth.split(" ")
    const monthNum = Number.parseInt(monthStr.substring(1))
    let prevMonthNum = monthNum - 1
    let prevYearNum = Number.parseInt(yearStr)

    if (prevMonthNum < 1) {
      prevMonthNum = 12
      prevYearNum -= 1
    }

    const previousMonth = `M${prevMonthNum} ${prevYearNum}`

    const allReviewsByReviewerPreviousMonth = await Review.find({
      reviewer: req.session.user._id,
      month: previousMonth,
    })
      .populate("employee", "name employeeId role")
      .populate("answers.question", "text category")
      .sort({ reviewDate: -1 })

    // Create a map of employee ID to their review from PREVIOUS month only
    const previousReviewsMap = {}
    allReviewsByReviewerPreviousMonth.forEach((review) => {
      if (!previousReviewsMap[review.employee._id.toString()]) {
        previousReviewsMap[review.employee._id.toString()] = review
      }
    })

    const selfAssessmentsMap = {}
    const allEmployeesToReviewIds = [
      ...employeesToReview.map((e) => e._id),
      ...departmentHODsToReview.map((h) => h._id),
      ...otherHODsToReview.map((h) => h._id),
    ]

    const selfAssessments = await SelfAssessment.find({
      employee: { $in: allEmployeesToReviewIds },
      $or: [{ month: selectedMonth }, { month: null }],
    }).populate("answers.question", "text category inputType")

    selfAssessments.forEach((assessment) => {
      selfAssessmentsMap[assessment.employee._id.toString()] = assessment
    })

    // Get previous month reviews for HODs (for higher-level HODs to see lower-level HOD reviews)
    const previousHODReviewsMap = {}
    const allHODsToReviewIds = [...departmentHODsToReview.map((h) => h._id), ...otherHODsToReview.map((h) => h._id)]
    
    const previousHODReviews = await Review.find({
      employee: { $in: allHODsToReviewIds },
      month: previousMonth,
    })
      .populate("employee", "name employeeId role")
      .populate("reviewer", "name")
      .populate("answers.question", "text category")
      .sort({ reviewDate: -1 })

    previousHODReviews.forEach((review) => {
      if (!previousHODReviewsMap[review.employee._id.toString()]) {
        previousHODReviewsMap[review.employee._id.toString()] = review
      }
    })

    res.render("hod/reviews", {
      employeesToReview,
      departmentHODsToReview,
      otherHODsToReview,
      questions,
      allReviews,
      selectedMonth,
      availableMonths,
      department: req.userDepartment,
      previousReviewsMap, // Pass the map of previous reviews from PREVIOUS month
      previousHODReviewsMap, // Pass the map of previous HOD reviews
      selfAssessmentsMap: JSON.stringify(selfAssessmentsMap),
    })
  } catch (error) {
    console.error("Error in /reviews GET:", error)
    res.status(500).render("error", { message: "Error loading reviews page" })
  }
})

// Submit Review - Updated for 6-point scale
router.post("/reviews", async (req, res) => {
  try {
    const { employee, answers, comments, month } = req.body
    const reviewMonth = month || getCurrentMonth()
    const reviewerId = req.session.user._id

    console.log("=== REVIEW SUBMISSION DEBUG ===")
    console.log("Current reviewer ID:", reviewerId)
    console.log("Current reviewer name:", req.session.user.name)
    console.log("Employee to review:", employee)
    console.log("Review month:", reviewMonth)

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

    const employeeDepartmentId = employeeDoc.department._id.toString()
    const canReviewEmployee = allAssignedDepartmentIds.includes(employeeDepartmentId) || employeeDoc.role === "hod"

    if (!canReviewEmployee) {
      console.log("❌ HOD not authorized to review this employee's department")
      return res.status(403).json({
        success: false,
        message: "You are not authorized to review employees from this department",
      })
    }

    console.log("✅ HOD authorized to review this employee")

    console.log("🔍 Checking for existing review with criteria:")
    console.log("  - Employee ID:", employee)
    console.log("  - Reviewer ID:", reviewerId)
    console.log("  - Month:", reviewMonth)

    const existingReview = await Review.findOne({
      employee: employee,
      reviewer: reviewerId,
      month: reviewMonth,
    })

    console.log("🔍 Existing review query result:", existingReview ? "FOUND" : "NOT FOUND")

    if (existingReview) {
      console.log("❌ Review already exists for this month:")
      console.log("  - Review ID:", existingReview._id)
      console.log("  - Month:", existingReview.month)

      return res.status(400).json({
        success: false,
        message: `You have already reviewed this person for ${reviewMonth}`,
      })
    }

    // Handle both new question-based and legacy review systems
    let parsedAnswers = []
    let overallScore = 3

    if (answers) {
      try {
        parsedAnswers = typeof answers === "string" ? JSON.parse(answers) : answers
        if (Array.isArray(parsedAnswers) && parsedAnswers.length > 0) {
          const totalRating = parsedAnswers.reduce((sum, answer) => sum + Number.parseInt(answer.rating), 0)
          overallScore = totalRating / parsedAnswers.length
        }
      } catch (error) {
        console.log("⚠️ Error parsing answers, using legacy system:", error.message)
        parsedAnswers = []
      }
    }

    // Create review data with selected month
    const reviewData = {
      employee: employee,
      reviewer: reviewerId,
      department: employeeDoc.department._id,
      month: reviewMonth,
      comments: comments.trim(),
    }

    if (parsedAnswers.length > 0) {
      reviewData.answers = parsedAnswers
      reviewData.overallScore = Math.round(overallScore * 100) / 100
    } else {
      reviewData.score = overallScore
    }

    console.log("📝 Creating review with data:")
    console.log("  - Employee:", reviewData.employee)
    console.log("  - Reviewer:", reviewData.reviewer)
    console.log("  - Month:", reviewData.month)
    console.log("  - Overall Score:", reviewData.overallScore)

    const newReview = await Review.create(reviewData)
    console.log("✅ Review created successfully with ID:", newReview._id)

    res.json({ success: true, message: "Review submitted successfully" })
  } catch (error) {
    console.error("❌ Submit review error:", error)

    if (error.code === 11000) {
      console.log("❌ Duplicate key error:", error.keyPattern)
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this person for this month",
      })
    }

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
      .populate("reviewer", "name employeeId role")
      .populate("department", "name")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    let csvContent =
      "Employee Name,Employee ID,Email,Role,Department,Month,Overall Score,Reviewer,Reviewer Role,Review Date,Comments\n"

    reviews.forEach((review) => {
      const employeeName = review.employee ? review.employee.name : "Unknown"
      const employeeId = review.employee ? review.employee.employeeId : "Unknown"
      const email = review.employee ? review.employee.email : "Unknown"
      const role = review.employee ? review.employee.role.toUpperCase() : "Unknown"
      const department = review.department ? review.department.name : "Unknown"
      const month = review.month || "N/A"
      const score = review.overallScore || review.score || "N/A"
      const reviewer = review.reviewer ? review.reviewer.name : "Unknown"
      const reviewerRole = review.reviewer ? review.reviewer.role.toUpperCase() : "Unknown"
      const reviewDate = new Date(review.reviewDate).toLocaleDateString()
      const comments = review.comments ? review.comments.replace(/"/g, '""').replace(/\n/g, " ") : ""

      csvContent += `"${employeeName}","${employeeId}","${email}","${role}","${department}","${month}","${score}","${reviewer}","${reviewerRole}","${reviewDate}","${comments}"\n`
    })

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

    // Get reviews for the selected month
    const reviews = await Review.find({
      month: currentMonth,
      department: { $in: allAssignedDepartmentIds },
    }).populate("employee", "name employeeId email").populate("reviewer", "name role")

    // Create performance summary
    const performanceData = []

    for (const employee of employees) {
      const employeeReviews = reviews.filter((r) => r.employee && r.employee._id.toString() === employee._id.toString())

      let avgScore = 0
      const reviewCount = employeeReviews.length
      const reviewers = []

      if (reviewCount > 0) {
        const totalScore = employeeReviews.reduce((sum, review) => {
          return sum + (review.overallScore || review.score || 0)
        }, 0)
        avgScore = (totalScore / reviewCount).toFixed(2)
        
        // Collect reviewer names
        employeeReviews.forEach((review) => {
          if (review.reviewer && review.reviewer.name) {
            reviewers.push(review.reviewer.name)
          }
        })
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
        reviewers: reviewers.length > 0 ? reviewers.join("; ") : "N/A",
        month: currentMonth,
      })
    }

    // Generate CSV content with selected month
    let csvContent =
      "Employee Name,Employee ID,Email,Department,Role,Average Score,Review Count,Reviewers,Performance Level,Month\n"

    performanceData.forEach((emp) => {
      csvContent += `"${emp.name}","${emp.employeeId}","${emp.email}","${emp.department}","${emp.role}","${emp.avgScore}","${emp.reviewCount}","${emp.reviewers}","${emp.performanceLevel}","${emp.month}"\n`
    })

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

// HOD Detailed Analysis Dashboard
router.get("/analysis", async (req, res) => {
  try {
    const currentHODId = req.session.user._id
    const assignedDepartments = await Department.find({
      hods: currentHODId,
      isActive: true,
    }).select("_id name")

    const assignedDepartmentIds = assignedDepartments.map((dept) => dept._id)

    // Get all sub-departments
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

    // Get all employees in assigned departments
    const employees = await User.find({
      department: { $in: allAssignedDepartmentIds },
      role: "employee",
      isActive: true,
    }).populate("department", "name")

    // Get all reviews for these employees
    const allReviews = await Review.find({
      employee: { $in: employees.map((e) => e._id) },
    }).populate("employee", "name employeeId email department")

    // Calculate employee-wise analytics
    const employeeAnalytics = []
    for (const employee of employees) {
      const employeeReviews = allReviews.filter((r) => r.employee._id.toString() === employee._id.toString())

      if (employeeReviews.length > 0) {
        const scores = employeeReviews.map((r) => r.effectiveScore)
        const avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
        const maxScore = Math.max(...scores)
        const minScore = Math.min(...scores)
        const trend = scores.length > 1 ? scores[scores.length - 1] - scores[0] : 0

        employeeAnalytics.push({
          employee,
          totalReviews: employeeReviews.length,
          avgScore,
          maxScore,
          minScore,
          trend: trend > 0 ? "up" : trend < 0 ? "down" : "stable",
          trendValue: Math.abs(trend).toFixed(2),
          reviews: employeeReviews.sort((a, b) => new Date(b.reviewDate) - new Date(a.reviewDate)),
        })
      }
    }

    // Sort by average score
    employeeAnalytics.sort((a, b) => Number.parseFloat(b.avgScore) - Number.parseFloat(a.avgScore))

    // Calculate department overview
    const departmentOverview = []
    for (const dept of assignedDepartments) {
      const deptEmployees = employees.filter((e) => e.department._id.toString() === dept._id.toString())
      const deptReviews = allReviews.filter((r) =>
        deptEmployees.map((e) => e._id.toString()).includes(r.employee._id.toString()),
      )

      if (deptReviews.length > 0) {
        const deptScores = deptReviews.map((r) => r.effectiveScore)
        const avgScore = (deptScores.reduce((a, b) => a + b, 0) / deptScores.length).toFixed(2)

        departmentOverview.push({
          name: dept.name,
          employeeCount: deptEmployees.length,
          reviewCount: deptReviews.length,
          avgScore,
        })
      }
    }

    // Performance distribution (score ranges)
    const performanceDistribution = {
      outstanding: 0, // 6
      superior: 0, // 5
      effective: 0, // 4
      standard: 0, // 3
      developing: 0, // 2
      ineffective: 0, // 1
    }

    allReviews.forEach((review) => {
      const score = Math.round(review.effectiveScore)
      if (score === 6) performanceDistribution.outstanding++
      else if (score === 5) performanceDistribution.superior++
      else if (score === 4) performanceDistribution.effective++
      else if (score === 3) performanceDistribution.standard++
      else if (score === 2) performanceDistribution.developing++
      else performanceDistribution.ineffective++
    })

    // Monthly trends
    const monthlyTrends = {}
    allReviews.forEach((review) => {
      if (!monthlyTrends[review.month]) {
        monthlyTrends[review.month] = { scores: [], count: 0 }
      }
      monthlyTrends[review.month].scores.push(review.effectiveScore)
      monthlyTrends[review.month].count++
    })

    const monthlyTrendData = Object.entries(monthlyTrends)
      .map(([month, data]) => ({
        month,
        avgScore: (data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(2),
        count: data.count,
      }))
      .sort((a, b) => {
        const [aMonth, aYear] = a.month
          .split(" ")
          .map((x, i) => (i === 0 ? Number.parseInt(x.substring(1)) : Number.parseInt(x)))
        const [bMonth, bYear] = b.month
          .split(" ")
          .map((x, i) => (i === 0 ? Number.parseInt(x.substring(1)) : Number.parseInt(x)))
        return aYear - bYear || aMonth - bMonth
      })

    res.render("hod/detailed-analysis", {
      employeeAnalytics,
      departmentOverview,
      performanceDistribution,
      monthlyTrendData,
      departmentName: assignedDepartments.map((d) => d.name).join(", "),
    })
  } catch (error) {
    console.error("HOD analysis error:", error)
    res.status(500).render("error", {
      message: "Error loading detailed analysis: " + error.message,
      user: req.session.user || null,
    })
  }
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
