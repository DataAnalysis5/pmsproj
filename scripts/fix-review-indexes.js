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

    // Drop the problematic index if it exists
    try {
      console.log("\n🗑️ Attempting to drop problematic index...")
      await reviewsCollection.dropIndex({ employee: 1, quarter: 1 })
      console.log("✅ Successfully dropped the problematic index { employee: 1, quarter: 1 }")
    } catch (error) {
      if (error.code === 27) {
        console.log("ℹ️ Index { employee: 1, quarter: 1 } doesn't exist or already dropped")
      } else {
        console.log("⚠️ Error dropping index:", error.message)
      }
    }

    // Drop any other problematic indexes that might exist
    try {
      console.log("\n🗑️ Checking for other problematic indexes...")
      const indexesToDrop = currentIndexes.filter((index) => {
        const key = JSON.stringify(index.key)
        return (
          (key === '{"employee":1,"quarter":1}' && index.unique) ||
          (index.name && index.name.includes("employee_1_quarter_1") && !index.name.includes("reviewer"))
        )
      })

      for (const index of indexesToDrop) {
        try {
          await reviewsCollection.dropIndex(index.name)
          console.log(`✅ Dropped problematic index: ${index.name}`)
        } catch (dropError) {
          console.log(`⚠️ Could not drop index ${index.name}:`, dropError.message)
        }
      }
    } catch (error) {
      console.log("⚠️ Error checking for problematic indexes:", error.message)
    }

    // Ensure the correct unique index exists
    try {
      console.log("\n🔧 Creating correct unique index...")
      await reviewsCollection.createIndex(
        { employee: 1, quarter: 1, reviewer: 1 },
        {
          unique: true,
          name: "employee_1_quarter_1_reviewer_1_unique",
        },
      )
      console.log("✅ Successfully created unique index { employee: 1, quarter: 1, reviewer: 1 }")
    } catch (error) {
      if (error.code === 85) {
        console.log("ℹ️ Unique index already exists")
      } else {
        console.log("⚠️ Error creating unique index:", error.message)
      }
    }

    // Create non-unique index for queries
    try {
      console.log("\n🔧 Creating non-unique query index...")
      await reviewsCollection.createIndex(
        { employee: 1, quarter: 1 },
        {
          unique: false,
          name: "employee_1_quarter_1_query_nonunique",
        },
      )
      console.log("✅ Successfully created non-unique index { employee: 1, quarter: 1 }")
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
    console.log("\n🎉 You can now have multiple HODs review the same employee in the same quarter!")
  } catch (error) {
    console.error("❌ Error fixing indexes:", error)
  } finally {
    await mongoose.disconnect()
    console.log("🔌 Disconnected from MongoDB")
  }
}

// Run the fix
fixReviewIndexes()
