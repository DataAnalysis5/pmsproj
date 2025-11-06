const mongoose = require("mongoose")

const answerSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 6,
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
    month: {
      type: String,
      required: true, // Format: "M1 2025"
    },
    // New question-based system
    answers: [answerSchema],
    overallScore: {
      type: Number,
      required: function () {
        return this.answers && this.answers.length > 0
      },
      min: 1,
      max: 6,
    },
    // Legacy fields for backward compatibility
    score: {
      type: Number,
      min: 1,
      max: 6,
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

reviewSchema.index({ employee: 1, month: 1, reviewer: 1 }, { unique: true })

// Add a non-unique index for efficient queries by employee and month
reviewSchema.index({ employee: 1, month: 1 })

// Virtual to get the effective score (overallScore or legacy score)
reviewSchema.virtual("effectiveScore").get(function () {
  return this.overallScore || this.score || 0
})

// Add error handling for duplicate key errors
reviewSchema.post("save", (error, doc, next) => {
  if (error.name === "MongoError" && error.code === 11000) {
    next(new Error("You have already reviewed this person for this month"))
  } else {
    next(error)
  }
})

module.exports = mongoose.model("Review", reviewSchema)
