const express = require("express")
const { requireAuth, requireRole } = require("../middleware/auth")
const User = require("../models/User")
const Review = require("../models/Review")

const router = express.Router()

// Apply employee role requirement to all routes
router.use(requireAuth, requireRole(["employee"]))

// Employee Dashboard
router.get("/dashboard", async (req, res) => {
  try {
    console.log("Loading employee dashboard...") // Debug log

    const employeeId = req.session.user._id
    const currentQuarter = getCurrentQuarter()

    // Get employee's reviews (aggregated by quarter)
    const allReviews = await Review.find({ employee: employeeId })
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
          // Use overallScore if available, otherwise use legacy score
          const score = review.overallScore || review.score || 0
          return sum + score
        }, 0) / reviews.length

      quarterlyAverages[quarter] = {
        avgScore: Math.round(avgScore * 100) / 100,
        reviewCount: reviews.length,
        reviews: reviews,
      }
    })

    // Current quarter data
    const currentQuarterData = quarterlyAverages[currentQuarter] || null

    // Overall average rating
    const allScores = Object.values(quarterlyAverages).map((q) => q.avgScore)
    const avgRating =
      allScores.length > 0 ? (allScores.reduce((sum, score) => sum + score, 0) / allScores.length).toFixed(2) : 0

    // Performance trend (last 4 quarters)
    const performanceTrend = getPerformanceTrend(quarterlyAverages)

    console.log("Employee dashboard data loaded successfully") // Debug log

    res.render("employee/dashboard", {
      employee: req.session.user,
      currentQuarterData: currentQuarterData,
      currentQuarterReview: currentQuarterData ? currentQuarterData.reviews[0] : null, // For backward compatibility
      quarterlyAverages,
      allReviews,
      avgRating,
      performanceTrend,
      currentQuarter,
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
