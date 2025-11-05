const mongoose = require("mongoose")
const path = require("path")

// Load .env from parent directory
require("dotenv").config({ path: path.join(__dirname, "..", ".env") })

async function fixUserIndexes() {
  try {
    console.log("Connecting to MongoDB...")
    console.log("MongoDB URI:", process.env.MONGODB_URI ? "Found" : "Not found")

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI not found in environment variables")
    }

    await mongoose.connect(process.env.MONGODB_URI)
    console.log("✅ Connected to MongoDB")

    const db = mongoose.connection.db
    const usersCollection = db.collection("users")

    console.log("📋 Current indexes on users collection:")
    const currentIndexes = await usersCollection.indexes()
    currentIndexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}:`, JSON.stringify(index.key), index.unique ? "(UNIQUE)" : "")
    })

    // Drop the email unique index if it exists
    try {
      console.log("\n🗑️ Attempting to drop email unique index...")
      await usersCollection.dropIndex({ email: 1 })
      console.log("✅ Successfully dropped the email unique index")
    } catch (error) {
      if (error.code === 27) {
        console.log("ℹ️ Email unique index doesn't exist or already dropped")
      } else {
        console.log("⚠️ Error dropping email index:", error.message)
      }
    }

    // Drop any other email-related unique indexes
    try {
      console.log("\n🗑️ Checking for other email-related unique indexes...")
      const emailIndexesToDrop = currentIndexes.filter((index) => {
        const key = JSON.stringify(index.key)
        return key.includes('"email":1') && index.unique
      })

      for (const index of emailIndexesToDrop) {
        try {
          await usersCollection.dropIndex(index.name)
          console.log(`✅ Dropped email unique index: ${index.name}`)
        } catch (dropError) {
          console.log(`⚠️ Could not drop index ${index.name}:`, dropError.message)
        }
      }
    } catch (error) {
      console.log("⚠️ Error checking for email indexes:", error.message)
    }

    // Ensure the employeeId unique index exists
    try {
      console.log("\n🔧 Creating/ensuring employeeId unique index...")
      await usersCollection.createIndex(
        { employeeId: 1 },
        {
          unique: true,
          name: "employeeId_1_unique",
        },
      )
      console.log("✅ Successfully created/ensured employeeId unique index")
    } catch (error) {
      if (error.code === 85) {
        console.log("ℹ️ EmployeeId unique index already exists")
      } else {
        console.log("⚠️ Error creating employeeId unique index:", error.message)
      }
    }

    // Create non-unique email index for queries
    try {
      console.log("\n🔧 Creating non-unique email index for queries...")
      await usersCollection.createIndex(
        { email: 1 },
        {
          unique: false,
          name: "email_1_nonunique",
        },
      )
      console.log("✅ Successfully created non-unique email index")
    } catch (error) {
      if (error.code === 85) {
        console.log("ℹ️ Non-unique email index already exists")
      } else {
        console.log("⚠️ Error creating email index:", error.message)
      }
    }

    console.log("\n📋 Final indexes on users collection:")
    const finalIndexes = await usersCollection.indexes()
    finalIndexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}:`, JSON.stringify(index.key), index.unique ? "(UNIQUE)" : "")
    })

    // Check for any existing users with the Employee ID you're trying to create
    console.log("\n🔍 Checking for existing users...")
    const allUsers = await usersCollection
      .find({}, { projection: { name: 1, email: 1, employeeId: 1, role: 1 } })
      .toArray()
    console.log(`Found ${allUsers.length} users in database:`)
    allUsers.forEach((user, i) => {
      console.log(`${i + 1}. ${user.name} - ${user.employeeId} - ${user.email} - ${user.role}`)
    })

    console.log("\n✅ User index fix completed successfully!")
    console.log("\n🎉 You can now create users with duplicate emails but unique Employee IDs!")
  } catch (error) {
    console.error("❌ Error fixing user indexes:", error)
  } finally {
    await mongoose.disconnect()
    console.log("🔌 Disconnected from MongoDB")
  }
}

// Run the fix
fixUserIndexes()
