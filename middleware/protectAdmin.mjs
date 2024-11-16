import { createClient } from "@supabase/supabase-js";
import connectionPool from "../utils/db.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware to check for valid JWT token and if the user has an "admin" role
const protectAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Get the token from Authorization header

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }

  try {
    // Use Supabase to get the user based on the token
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    // Get user ID from Supabase user data
    const supabaseUserId = data.user.id;

    // Fetch the user's role from your PostgreSQL database
    const query = `SELECT role FROM users WHERE id = $1`;
    const values = [supabaseUserId];
    const { rows, error: dbError } = await connectionPool.query(query, values);

    if (dbError || !rows.length) {
      return res.status(404).json({ error: "User role not found" });
    }

    // Attach the user data and role to the request object
    req.user = { ...data.user, role: rows[0].role };

    // Check if the user is an admin
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Forbidden: You do not have admin access" });
    }

    // Proceed to the next middleware or route handler if the user is an admin
    next();
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export default protectAdmin;
