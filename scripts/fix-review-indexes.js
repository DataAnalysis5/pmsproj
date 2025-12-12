const mongoose = require("mongoose")
const path = require("path")

// Load .env from parent directory
require("dotenv").config({ path: path.join(__dirname, "..", ".env") })

async function fixReviewIndexes() {
  try {
    console.log("Connecting to MongoDB...")
    console.log("MongoDB URI:", process.env.MONGODB_URI ? "Found" : "Not found")

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI not found in environment variables")
    }

    await mongoose.connect(process.env.MONGODB_URI)
    console.log("✅ Connected to MongoDB")

    const db = mongoose.connection.db
    const reviewsCollection = db.collection("reviews")

    console.log("📋 Current indexes on reviews collection:")
    const currentIndexes = await reviewsCollection.indexes()
    currentIndexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}:`, JSON.stringify(index.key), index.unique ? "(UNIQUE)" : "")
    })

    // Drop the old quarter-based unique index if it exists
    try {
      console.log("\n🗑️ Attempting to drop old quarter-based indexes...")
      await reviewsCollection.dropIndex("employee_1_quarter_1_reviewer_1")
      console.log("✅ Successfully dropped the old index: employee_1_quarter_1_reviewer_1")
    } catch (error) {
      if (error.code === 27) {
        console.log("ℹ️ Index employee_1_quarter_1_reviewer_1 doesn't exist")
      } else {
        console.log("⚠️ Error dropping index:", error.message)
      }
    }

    // Drop other old quarter indexes
    try {
      const indexesToDrop = currentIndexes.filter((index) => {
        return index.name && index.name.includes("quarter") && !index.name.includes("_id_")
      })

      for (const index of indexesToDrop) {
        try {
          await reviewsCollection.dropIndex(index.name)
          console.log(`✅ Dropped old index: ${index.name}`)
        } catch (dropError) {
          console.log(`⚠️ Could not drop index ${index.name}:`, dropError.message)
        }
      }
    } catch (error) {
      console.log("⚠️ Error checking for old indexes:", error.message)
    }

    // Ensure the correct NEW unique index with month exists
    try {
      console.log("\n🔧 Creating correct unique index with month field...")
      await reviewsCollection.createIndex(
        { employee: 1, month: 1, reviewer: 1 },
        {
          unique: true,
          name: "employee_1_month_1_reviewer_1_unique",
        },
      )
      console.log("✅ Successfully created unique index { employee: 1, month: 1, reviewer: 1 }")
    } catch (error) {
      if (error.code === 85) {
        console.log("ℹ️ Unique month-based index already exists")
      } else {
        console.log("⚠️ Error creating unique index:", error.message)
      }
    }

    // Create non-unique index for month queries
    try {
      console.log("\n🔧 Creating non-unique query index...")
      await reviewsCollection.createIndex(
        { employee: 1, month: 1 },
        {
          unique: false,
          name: "employee_1_month_1_query_nonunique",
        },
      )
      console.log("✅ Successfully created non-unique index { employee: 1, month: 1 }")
    } catch (error) {
      if (error.code === 85) {
        console.log("ℹ️ Query index already exists")
      } else {
        console.log("⚠️ Error creating query index:", error.message)
      }
    }

    console.log("\n📋 Final indexes on reviews collection:")
    const finalIndexes = await reviewsCollection.indexes()
    finalIndexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}:`, JSON.stringify(index.key), index.unique ? "(UNIQUE)" : "")
    })

    console.log("\n✅ Index fix completed successfully!")
    console.log("\n🎉 HODs can now review the same employee for different months!")
  } catch (error) {
    console.error("❌ Error fixing indexes:", error)
  } finally {
    await mongoose.disconnect()
    console.log("🔌 Disconnected from MongoDB")
  }
}

// Run the fix
fixReviewIndexes()
