const express = require("express")
const { requireAuth, requireRole } = require("../middleware/auth")
const User = require("../models/User")
const Review = require("../models/Review")
const Question = require("../models/Question")

const router = express.Router()

// Apply employee role requirement to all routes
router.use(requireAuth, requireRole(["employee"]))

// Employee Dashboard (updated to include self-assessment data)
router.get("/dashboard", async (req, res) => {
  try {
    console.log("Loading employee dashboard...") // Debug log

    const employeeId = req.session.user._id
    const currentQuarter = getCurrentQuarter()

    // Self-assessment questions: global + employee's department (assessmentType=self)
    const employeeDoc = await User.findById(employeeId).populate("department", "name _id")
    let selfQuestions = []
    try {
      selfQuestions = await Question.find({
        assessmentType: "self",
        isActive: true,
        $or: [{ department: null }, { department: employeeDoc?.department?._id || null }],
      })
        .populate("department", "name")
        .sort({ createdAt: 1 })
    } catch (e) {
      console.log("Error fetching self assessment questions:", e.message)
      selfQuestions = []
    }

    // Get employee's self assessment for current quarter (if any)
    const selfAssessment = await Review.findOne({
      employee: employeeId,
      reviewer: employeeId,
      quarter: currentQuarter,
      isSelfAssessment: true,
    })
      .populate("answers.question", "text inputType options category department")
      .exec()

    // Get employee's reviews (exclude self assessments) aggregated by quarter
    const allReviews = await Review.find({ employee: employeeId, isSelfAssessment: { $ne: true } })
      .populate("reviewer", "name")
      .populate("department", "name")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    // Group reviews by quarter and calculate averages
    const reviewsByQuarter = {}
    allReviews.forEach((review) => {
      if (!reviewsByQuarter[review.quarter]) {
        reviewsByQuarter[review.quarter] = []
      }
      reviewsByQuarter[review.quarter].push(review)
    })

    // Calculate average scores per quarter
    const quarterlyAverages = {}
    Object.keys(reviewsByQuarter).forEach((quarter) => {
      const reviews = reviewsByQuarter[quarter]
      const avgScore =
        reviews.reduce((sum, review) => {
          const score = review.overallScore || review.score || 0
          return sum + score
        }, 0) / reviews.length

      quarterlyAverages[quarter] = {
        avgScore: Math.round(avgScore * 100) / 100,
        reviewCount: reviews.length,
        reviews: reviews,
      }
    })

    // Current quarter data (from HOD reviews only)
    const currentQuarterData = quarterlyAverages[currentQuarter] || null

    // Overall average rating (exclude self assessments)
    const allScores = Object.values(quarterlyAverages).map((q) => q.avgScore)
    const avgRating =
      allScores.length > 0 ? (allScores.reduce((sum, score) => sum + score, 0) / allScores.length).toFixed(2) : 0

    // Performance trend (last 4 quarters) exclude self assessments
    const performanceTrend = getPerformanceTrend(quarterlyAverages)

    console.log("Employee dashboard data loaded successfully") // Debug log

    res.render("employee/dashboard", {
      employee: req.session.user,
      currentQuarterData,
      currentQuarterReview: currentQuarterData ? currentQuarterData.reviews[0] : null,
      quarterlyAverages,
      allReviews,
      avgRating,
      performanceTrend,
      currentQuarter,
      totalReviews: allReviews.length,
      selfQuestions,
      selfAssessment,
    })
  } catch (error) {
    console.error("Employee dashboard error:", error)
    res.status(500).render("error", {
      message: "Error loading dashboard: " + error.message,
      user: req.session.user || null,
    })
  }
})

// Submit or Update Self Assessment
router.post("/self-assessment", async (req, res) => {
  try {
    const employeeId = req.session.user._id
    const currentQuarter = getCurrentQuarter()
    const { answers, comments } = req.body

    if (!comments || !comments.trim()) {
      return res.status(400).json({ success: false, message: "Overall comments are required" })
    }

    // Ensure answers is an array
    let parsedAnswers = []
    if (answers) {
      parsedAnswers = Array.isArray(answers) ? answers : JSON.parse(answers)
    }

    // Load employee department
    const employeeDoc = await User.findById(employeeId).populate("department", "_id")
    if (!employeeDoc) {
      return res.status(400).json({ success: false, message: "Employee not found" })
    }

    // Validate answers structure minimally
    const normalizedAnswers = (parsedAnswers || []).map((a) => ({
      question: a.question,
      // optional rating for rating self-questions if any
      rating: typeof a.rating === "number" ? a.rating : undefined,
      responseOption: a.responseOption || undefined,
      responseText: a.responseText || undefined,
    }))

    // Upsert self assessment
    const existing = await Review.findOne({
      employee: employeeId,
      reviewer: employeeId,
      quarter: currentQuarter,
      isSelfAssessment: true,
    })

    const reviewData = {
      employee: employeeId,
      reviewer: employeeId,
      department: employeeDoc.department?._id || null,
      quarter: currentQuarter,
      isSelfAssessment: true,
      answers: normalizedAnswers,
      comments: comments.trim(),
    }

    if (existing) {
      await Review.updateOne({ _id: existing._id }, reviewData)
    } else {
      await Review.create(reviewData)
    }

    return res.json({ success: true, message: "Self assessment saved" })
  } catch (error) {
    console.error("Self assessment error:", error)
    return res.status(500).json({ success: false, message: "Error saving self assessment: " + error.message })
  }
})

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

// Helper function to get performance trend
function getPerformanceTrend(quarterlyAverages) {
  const trend = []
  const currentDate = new Date()

  for (let i = 3; i >= 0; i--) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i * 3, 1)
    const month = date.getMonth() + 1
    const year = date.getFullYear()

    let quarter
    if (month <= 3) quarter = "Q1"
    else if (month <= 6) quarter = "Q2"
    else if (month <= 9) quarter = "Q3"
    else quarter = "Q4"

    const quarterStr = `${quarter} ${year}`
    const quarterData = quarterlyAverages[quarterStr]

    trend.push({
      quarter: quarterStr,
      score: quarterData ? quarterData.avgScore : null,
      reviewCount: quarterData ? quarterData.reviewCount : 0,
    })
  }

  return trend
}

module.exports = router
