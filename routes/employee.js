const express = require("express")
const bcrypt = require("bcryptjs")
const { body, validationResult } = require("express-validator")
const { requireAuth, requireRole } = require("../middleware/auth")
const User = require("../models/User")
const Review = require("../models/Review")
const SelfAssessment = require("../models/SelfAssessment")
const Question = require("../models/Question")

const router = express.Router()

// Apply employee role requirement to all routes
router.use(requireAuth, requireRole(["employee"]))

// Employee Dashboard
router.get("/dashboard", async (req, res) => {
  try {
    console.log("Loading employee dashboard...")

    const employeeId = req.session.user._id
    const currentMonth = getCurrentMonth()

    // Get employee's reviews (aggregated by month)
    const allReviews = await Review.find({ employee: employeeId })
      .populate("reviewer", "name")
      .populate("department", "name")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    // Anonymize reviewer names for employees - create a mapping
    const reviewerAnonymousMap = {}
    let reviewerCounter = 1
    
    allReviews.forEach((review) => {
      const reviewerId = review.reviewer._id.toString()
      if (!reviewerAnonymousMap[reviewerId]) {
        reviewerAnonymousMap[reviewerId] = `Person ${reviewerCounter}`
        reviewerCounter++
      }
      // Replace reviewer name with anonymous name
      review.reviewer.name = reviewerAnonymousMap[reviewerId]
    })

    const reviewsByMonth = {}
    allReviews.forEach((review) => {
      if (!reviewsByMonth[review.month]) {
        reviewsByMonth[review.month] = []
      }
      reviewsByMonth[review.month].push(review)
    })

    const monthlyAverages = {}
    Object.keys(reviewsByMonth).forEach((month) => {
      const reviews = reviewsByMonth[month]
      const avgScore =
        reviews.reduce((sum, review) => {
          const score = review.overallScore || review.score || 0
          return sum + score
        }, 0) / reviews.length

      monthlyAverages[month] = {
        avgScore: Math.round(avgScore * 100) / 100,
        reviewCount: reviews.length,
        reviews: reviews,
      }
    })

    const currentMonthData = monthlyAverages[currentMonth] || null

    // Overall average rating
    const allScores = Object.values(monthlyAverages).map((m) => m.avgScore)
    const avgRating =
      allScores.length > 0 ? (allScores.reduce((sum, score) => sum + score, 0) / allScores.length).toFixed(2) : 0

    const performanceTrend = getPerformanceTrend(monthlyAverages)

    console.log("Employee dashboard data loaded successfully")

    res.render("employee/dashboard", {
      employee: req.session.user,
      currentMonthData: currentMonthData,
      currentMonthReview: currentMonthData ? currentMonthData.reviews[0] : null,
      monthlyAverages,
      allReviews,
      avgRating,
      performanceTrend,
      currentMonth,
      totalReviews: allReviews.length,
    })
  } catch (error) {
    console.error("Employee dashboard error:", error)
    res.status(500).render("error", {
      message: "Error loading dashboard: " + error.message,
      user: req.session.user || null,
    })
  }
})

router.get("/change-password", (req, res) => {
  try {
    res.render("employee/change-password", {
      employee: req.session.user,
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
        return res.render("employee/change-password", {
          employee: req.session.user,
          error: errors.array()[0].msg,
          success: null,
        })
      }

      const { currentPassword, newPassword } = req.body
      const userId = req.session.user._id

      // Get user from database
      const user = await User.findById(userId)
      if (!user) {
        return res.render("employee/change-password", {
          employee: req.session.user,
          error: "User not found",
          success: null,
        })
      }

      // Verify current password
      const isMatch = await bcrypt.compare(currentPassword, user.password)
      if (!isMatch) {
        return res.render("employee/change-password", {
          employee: req.session.user,
          error: "Current password is incorrect",
          success: null,
        })
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12)

      // Update password in database
      await User.findByIdAndUpdate(userId, { password: hashedPassword })

      console.log("Password changed successfully for user:", user.name)

      res.render("employee/change-password", {
        employee: req.session.user,
        error: null,
        success: "Password changed successfully!",
      })
    } catch (error) {
      console.error("Change password error:", error)
      res.render("employee/change-password", {
        employee: req.session.user,
        error: "Error changing password: " + error.message,
        success: null,
      })
    }
  },
)

// Self-Assessment Form
router.get("/self-assessment", async (req, res) => {
  try {
    const employeeId = req.session.user._id
    const selectedMonth = req.query.month || getCurrentMonth()

    // Get employee's department
    const employee = await User.findById(employeeId).populate("department")

    if (!employee || !employee.department) {
      return res.render("employee/self-assessment", {
        employee: req.session.user,
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

    // Get self-assessment questions for this employee's department (only for employees)
    const questions = await Question.find({
      questionType: "self-assessment",
      questionFor: { $in: ["employee", undefined, null] }, // Default to employee questions
      isActive: true,
      $or: [
        { department: null }, // Global questions
        { department: employee.department._id }, // Questions for employee's department
      ],
    })
      .populate("department", "name")
      .sort({ category: 1, createdAt: 1 })

    // Check if already submitted for selected month
    const existingAssessment = await SelfAssessment.findOne({
      employee: employeeId,
      month: selectedMonth,
    })

    res.render("employee/self-assessment", {
      employee: req.session.user,
      questions,
      selectedMonth,
      availableMonths,
      existingAssessment: existingAssessment ? existingAssessment : null,
      success: null,
      error: null,
    })
  } catch (error) {
    console.error("Self-assessment form error:", error)
    res.status(500).render("error", {
      message: "Error loading self-assessment form",
      user: req.session.user || null,
    })
  }
})

// Submit Self-Assessment
router.post("/self-assessment", async (req, res) => {
  try {
    const employeeId = req.session.user._id
    const { month, answers } = req.body

    // Get employee's department
    const employee = await User.findById(employeeId).populate("department")

    if (!employee || !employee.department) {
      return res.status(400).json({ success: false, message: "Employee department not found" })
    }

    const existingAssessment = await SelfAssessment.findOne({
      employee: employeeId,
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
      console.log("Self-assessment updated for employee:", employee.name, "Month:", month)
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
      employee: employeeId,
      department: employee.department._id,
      month: month,
      answers: processedAnswers,
    })

    await selfAssessment.save()
    console.log("Self-assessment submitted for employee:", employee.name, "Month:", month)

    res.json({ success: true, message: "Self-assessment submitted successfully!" })
  } catch (error) {
    console.error("Self-assessment submission error:", error)
    res.status(500).json({ success: false, message: "Error submitting self-assessment: " + error.message })
  }
})

function getCurrentMonth() {
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()
  return `M${month} ${year}`
}

function getPerformanceTrend(monthlyAverages) {
  const trend = []
  const currentDate = new Date()

  for (let i = 11; i >= 0; i--) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1)
    const month = date.getMonth() + 1
    const year = date.getFullYear()

    const monthStr = `M${month} ${year}`
    const monthData = monthlyAverages[monthStr]

    trend.push({
      month: monthStr,
      score: monthData ? monthData.avgScore : null,
      reviewCount: monthData ? monthData.reviewCount : 0,
    })
  }

  return trend
}

module.exports = router
