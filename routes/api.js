const express = require("express")
const { body, validationResult } = require("express-validator")
const { requireAuth, requireRole } = require("../middleware/auth")
const Review = require("../models/Review")
const User = require("../models/User")
const Department = require("../models/Department")
const Question = require("../models/Question")

const router = express.Router()

// Apply authentication to all API routes
router.use(requireAuth)

// HOD: Create questions for HOD reviews (Higher HOD only)
router.post(
  "/hod/questions",
  [
    body("text").trim().notEmpty().withMessage("Question text is required"),
    body("category")
      .isIn(["performance", "quiz", "attendance", "late_remark", "behaviour", "extra"])
      .withMessage("Valid category is required"),
  ],
  async (req, res) => {
    try {
      // Check if user is HOD with higher level
      const user = await User.findById(req.session.user._id)
      if (!user || user.role !== "hod" || user.hodLevel !== "higher") {
        return res.status(403).json({
          success: false,
          message: "Only Higher Level HODs can create questions",
        })
      }

      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: errors.array()[0].msg,
        })
      }

      const { text, category, department, month } = req.body

      const questionData = {
        text,
        category,
        questionType: "review",
        createdBy: req.session.user._id,
        isActive: true,
      }

      if (month && month.trim() !== "") {
        questionData.month = month
      }

      if (department && department.trim() !== "") {
        questionData.department = department
      }

      const newQuestion = await Question.create(questionData)
      console.log(
        "HOD Question created:",
        newQuestion.text,
        "for department:",
        newQuestion.department || "Global",
        "by HOD:",
        user.name,
      )

      res.json({ success: true, message: "Question created successfully", question: newQuestion })
    } catch (error) {
      console.error("HOD question creation error:", error)
      res.status(500).json({
        success: false,
        message: "Error creating question: " + error.message,
      })
    }
  },
)

// Get performance data for charts
router.get("/performance-data", async (req, res) => {
  try {
    const { type, departmentId } = req.query

    if (type === "quarterly-trend") {
      const trends = await getQuarterlyTrends(departmentId)
      res.json(trends)
    } else if (type === "department-comparison") {
      const comparison = await getDepartmentComparison()
      res.json(comparison)
    } else {
      res.status(400).json({ error: "Invalid data type" })
    }
  } catch (error) {
    console.error("API performance data error:", error)
    res.status(500).json({ error: "Server error" })
  }
})

// Helper functions
async function getQuarterlyTrends(departmentId) {
  const trends = []
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

    const matchCondition = { quarter: quarterStr }
    if (departmentId) {
      matchCondition.department = departmentId
    }

    const avgResult = await Review.aggregate([
      { $match: matchCondition },
      { $group: { _id: null, avgRating: { $avg: "$score" }, count: { $sum: 1 } } },
    ])

    trends.push({
      quarter: quarterStr,
      avgRating: avgResult.length > 0 ? Number.parseFloat(avgResult[0].avgRating.toFixed(2)) : 0,
      reviewCount: avgResult.length > 0 ? avgResult[0].count : 0,
    })
  }

  return trends
}

async function getDepartmentComparison() {
  const currentQuarter = getCurrentQuarter()

  const comparison = await Review.aggregate([
    { $match: { quarter: currentQuarter } },
    {
      $lookup: {
        from: "departments",
        localField: "department",
        foreignField: "_id",
        as: "dept",
      },
    },
    { $unwind: "$dept" },
    {
      $group: {
        _id: "$dept.name",
        avgRating: { $avg: "$score" },
        reviewCount: { $sum: 1 },
      },
    },
    { $sort: { avgRating: -1 } },
  ])

  return comparison.map((item) => ({
    department: item._id,
    avgRating: Number.parseFloat(item.avgRating.toFixed(2)),
    reviewCount: item.reviewCount,
  }))
}

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

module.exports = router
