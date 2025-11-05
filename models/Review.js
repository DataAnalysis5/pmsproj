const mongoose = require("mongoose")

const answerSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    required: true,
  },
  // Rating only for review/rating questions (1..6)
  rating: {
    type: Number,
    min: 1,
    max: 6,
  },
  // Self-assessment responses (MCQ/Text)
  responseOption: {
    type: String, // for MCQ selections
  },
  responseText: {
    type: String, // for text answers
    trim: true,
  },
})

const reviewSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    quarter: {
      type: String,
      required: true, // Format: "Q1 2025"
    },
    // Distinguish self assessment from HOD reviews
    isSelfAssessment: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Question-based system (supports rating/mcq/text)
    answers: [answerSchema],
    overallScore: {
      type: Number,
      required: function () {
        // Only required for HOD reviews (not self assessments) when answers exist
        return this.answers && this.answers.length > 0 && this.isSelfAssessment !== true
      },
      min: 1,
      max: 6, // 6-point scale
    },
    // Legacy fields for backward compatibility
    score: {
      type: Number,
      min: 1,
      max: 6, // 6-point scale
    },
    comments: {
      type: String,
      required: true,
      trim: true,
    },
    reviewDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
)

// Unique constraint: same reviewer cannot review same employee in same quarter twice
reviewSchema.index({ employee: 1, quarter: 1, reviewer: 1 }, { unique: true })

// Non-unique index for efficient queries by employee and quarter
reviewSchema.index({ employee: 1, quarter: 1 })

// Virtual to get the effective score (overallScore or legacy score)
reviewSchema.virtual("effectiveScore").get(function () {
  return this.overallScore || this.score || 0
})

// Add error handling for duplicate key errors
reviewSchema.post("save", (error, doc, next) => {
  if (error.name === "MongoError" && error.code === 11000) {
    next(new Error("You have already reviewed this person for this quarter"))
  } else {
    next(error)
  }
})

module.exports = mongoose.model("Review", reviewSchema)
