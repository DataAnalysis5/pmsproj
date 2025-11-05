# Performance Management System (PMS)

A comprehensive Performance Management System built with Node.js, Express.js, MongoDB, and EJS templates. This system is inspired by the KISNA Performance Management Guide and provides role-based access control for Admins, HODs, and Employees.

## Features

### 🔐 Authentication & Authorization
- Secure login/logout system with session management
- Password hashing using bcryptjs
- Role-based access control (Admin, HOD, Employee)
- Department-level access restrictions for HODs

### 👥 User Management
- **Admin**: Full system access, manage departments and employees
- **HOD**: Department-specific access, review employees in their department
- **Employee**: View personal performance and review history

### 📊 Dashboard Analytics
- Real-time performance statistics from MongoDB
- Department-wise performance comparison
- Quarterly trend analysis
- Dynamic data visualization (no hardcoded values)

### 📝 Review System
- Quarterly performance reviews (Q1, Q2, Q3, Q4)
- Score-based rating system (1-5 scale)
- Detailed comments and feedback
- Duplicate review prevention per quarter
- Automatic quarter detection

### 🏢 Department Management
- Create and manage departments
- Assign HODs to departments
- HOD level designation (Higher/Lower level)

## Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **Frontend**: EJS templates, HTML, CSS, JavaScript
- **Authentication**: Express sessions with MongoDB store
- **Validation**: Express-validator
- **Styling**: Custom CSS with responsive design

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or cloud instance)
- npm or yarn package manager

### Installation Steps

1. **Clone the repository**
\`\`\`bash
git clone <repository-url>
cd performance-management-system
\`\`\`

2. **Install dependencies**
\`\`\`bash
npm install
\`\`\`

3. **Environment Configuration**
Create a `.env` file in the root directory:
\`\`\`env
MONGODB_URI=mongodb://localhost:27017/pms_system
SESSION_SECRET=your_super_secret_session_key_here
PORT=3000
NODE_ENV=development
ADMIN_EMAIL=admin@company.com
ADMIN_PASSWORD=admin123
\`\`\`

4. **Start MongoDB**
Make sure MongoDB is running on your system.

5. **Run the application**
\`\`\`bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
\`\`\`

6. **Access the application**
Open your browser and navigate to `http://localhost:3000`

## Default Login Credentials

**Admin Account:**
- Email: admin@company.com
- Password: admin123

## Project Structure

\`\`\`
performance-management-system/
├── models/
│   ├── User.js          # User schema (Admin, HOD, Employee)
│   ├── Department.js    # Department schema
│   └── Review.js        # Performance review schema
├── routes/
│   ├── auth.js          # Authentication routes
│   ├── admin.js         # Admin dashboard and management
│   ├── hod.js           # HOD dashboard and reviews
│   ├── employee.js      # Employee dashboard
│   └── api.js           # API endpoints for data
├── middleware/
│   └── auth.js          # Authentication middleware
├── views/
│   ├── layout.ejs       # Main layout template
│   ├── login.ejs        # Login page
│   ├── admin/           # Admin templates
│   ├── hod/             # HOD templates
│   ├── employee/        # Employee templates
│   └── error.ejs        # Error page
├── public/
│   ├── css/
│   │   └── style.css    # Main stylesheet
│   └── js/
│       └── main.js      # Client-side JavaScript
├── server.js            # Main server file
├── package.json         # Dependencies and scripts
└── .env                 # Environment variables
\`\`\`

## Key Features Explained

### Quarter-Based Reviews
- System automatically detects current quarter based on date
- Prevents duplicate reviews in the same quarter
- Historical review tracking across quarters

### Role-Based Access Control
- **Admin**: Can manage all users, departments, and view system-wide analytics
- **HOD**: Can only access their assigned department and review employees within it
- **Employee**: Can only view their own performance data and review history

### Real-Time Analytics
- All dashboard statistics are calculated dynamically from MongoDB
- Department-wise performance comparisons
- Quarterly trend analysis
- Average rating calculations

### Security Features
- Password hashing with bcryptjs
- Session-based authentication
- CSRF protection through proper form handling
- Input validation and sanitization

## API Endpoints

### Authentication
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout

### Admin Routes
- `GET /admin/dashboard` - Admin dashboard with system statistics
- `GET /admin/departments` - Department management
- `POST /admin/departments` - Create new department
- `GET /admin/employees` - Employee management
- `POST /admin/employees` - Create new employee

### HOD Routes
- `GET /hod/dashboard` - HOD dashboard with department statistics
- `GET /hod/reviews` - Review management interface
- `POST /hod/reviews` - Submit employee review

### Employee Routes
- `GET /employee/dashboard` - Employee performance dashboard

## Database Schema

### User Collection
\`\`\`javascript
{
  name: String,
  email: String (unique),
  password: String (hashed),
  employeeId: String (unique),
  role: ['admin', 'hod', 'employee'],
  department: ObjectId (ref: Department),
  hodLevel: ['higher', 'lower'], // Only for HODs
  joiningDate: Date,
  isActive: Boolean
}
\`\`\`

### Department Collection
\`\`\`javascript
{
  name: String (unique),
  description: String,
  hod: ObjectId (ref: User),
  isActive: Boolean
}
\`\`\`

### Review Collection
\`\`\`javascript
{
  employee: ObjectId (ref: User),
  reviewer: ObjectId (ref: User),
  department: ObjectId (ref: Department),
  quarter: String, // Format: "Q1 2025"
  score: Number (1-5),
  comments: String,
  reviewDate: Date
}
\`\`\`

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/new-feature`)
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the repository or contact the development team.
