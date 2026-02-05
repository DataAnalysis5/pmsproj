const mongoose = require("mongoose")

const selfAssessmentAnswerSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    required: true,
  },
  answer: {
    type: mongoose.Schema.Types.Mixed, // Can be string, number, or array for checkbox
    required: true,
  },
})

const selfAssessmentSchema = new mongoose.Schema(
  {
    employee: {
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
    answers: [selfAssessmentAnswerSchema],
    submittedDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
)

selfAssessmentSchema.index({ employee: 1, month: 1 }, { unique: true })

module.exports = mongoose.model("SelfAssessment", selfAssessmentSchema)
