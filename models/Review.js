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

reviewSchema.statics.initializeIndexes = async function () {
  try {
    // Get all existing indexes
    const indexes = await this.collection.getIndexes()

    // Check if old index exists and drop it
    if (indexes["employee_1_quarter_1_reviewer_1"]) {
      console.log("🗑️  Dropping old index: employee_1_quarter_1_reviewer_1")
      await this.collection.dropIndex("employee_1_quarter_1_reviewer_1")
      console.log("✅ Old index dropped successfully")
    }

    // Ensure new indexes are created
    await this.collection.ensureIndex({ employee: 1, month: 1, reviewer: 1 }, { unique: true })
    console.log("✅ New index ensured: employee_1_month_1_reviewer_1")
  } catch (error) {
    console.error("⚠️  Index initialization error (non-critical):", error.message)
  }
}

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

const ReviewModel = mongoose.model("Review", reviewSchema)
ReviewModel.initializeIndexes().catch((err) => {
  console.error("Failed to initialize Review indexes:", err)
})

module.exports = ReviewModel
