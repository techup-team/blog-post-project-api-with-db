import { Router } from "express";
import connectionPool from "../utils/db.mjs";
import protectAdmin from "../middleware/protectAdmin.mjs";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const postRouter = Router();

const multerUpload = multer({ storage: multer.memoryStorage() });

const imageFileUpload = multerUpload.fields([
  { name: "imageFile", maxCount: 1 },
]);

postRouter.post("/", [imageFileUpload, protectAdmin], async (req, res) => {
  // ลอจิกในการเก็บข้อมูลของโพสต์ลงในฐานข้อมูล

  // 1) Access ข้อมูลใน Body จาก Request ด้วย req.body
  const newPost = req.body;
  const file = req.files.imageFile[0];

  // Define the Supabase Storage bucket name (replace with your bucket name)
  const bucketName = "my-personal-blog";
  const filePath = `posts/${Date.now()}`; // Unique file path

  // 2) เขียน Query เพื่อ Insert ข้อมูลโพสต์ ด้วย Connection Pool
  try {
    // Upload the image to Supabase storage
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false, // Prevent overwriting the file
      });

    if (error) {
      throw error; // If an error occurs while uploading
    }
    // Get the public URL of the uploaded file
    const {
      data: { publicUrl },
    } = supabase.storage.from(bucketName).getPublicUrl(data.path);

    const query = `INSERT INTO posts (title, image, category_id, description, content, status_id)
      values ($1, $2, $3, $4, $5, $6)`;

    const values = [
      newPost.title,
      publicUrl,
      parseInt(newPost.category_id),
      newPost.description,
      newPost.content,
      parseInt(newPost.status_id),
    ];

    await connectionPool.query(query, values);
  } catch (err) {
    return res.status(500).json({
      message: `Server could not create post because database connection`,
    });
  }

  // 3) Return ตัว Response กลับไปหา Client ว่าสร้างสำเร็จ
  return res.status(201).json({ message: "Created post successfully" });
});

// get all published posts
postRouter.get("/", async (req, res) => {
  // ลอจิกในอ่านข้อมูลโพสต์ทั้งหมดในระบบ
  try {
    // 1) Access ข้อมูลใน Body จาก Request ด้วย req.body
    const category = req.query.category || "";
    const keyword = req.query.keyword || "";
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 6;

    // 2) ทำให้แน่ใจว่า query parameter page และ limit จะมีค่าอย่างต่ำเป็น 1
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(100, limit));
    const offset = (safePage - 1) * safeLimit;
    // offset คือค่าที่ใช้ในการข้ามจำนวนข้อมูลบางส่วนตอน query ข้อมูลจาก database
    // ถ้า page = 2 และ limit = 6 จะได้ offset = (2 - 1) * 6 = 6 หมายความว่าต้องข้ามแถวไป 6 แถวแรก และดึงแถวที่ 7-12 แทน

    // 3) เขียน Query เพื่อ Insert ข้อมูลโพสต์ ด้วย Connection Pool
    let query = `
    SELECT 
        posts.*, 
        categories.name AS category, 
        statuses.status
    FROM posts
    INNER JOIN categories ON posts.category_id = categories.id
    INNER JOIN statuses ON posts.status_id = statuses.id
    WHERE statuses.id = 2 
  `;
    let values = []; // status id = 2 means showing only publish post

    // 4) เขียน query จากเงื่อนไขของการใส่ query parameter category และ keyword
    if (category && keyword) {
      query += `
          AND categories.name ILIKE $1 
          AND (posts.title ILIKE $2 OR posts.description ILIKE $2 OR posts.content ILIKE $2)
        `;
      values = [`%${category}%`, `%${keyword}%`];
    } else if (category) {
      query += " AND categories.name ILIKE $1";
      values = [`%${category}%`];
    } else if (keyword) {
      query += `
          AND (posts.title ILIKE $1 
          OR posts.description ILIKE $1 
          OR posts.content ILIKE $1)
        `;
      values = [`%${keyword}%`];
    }

    // 5) เพิ่มการ odering ตามวันที่, limit และ offset
    query += ` ORDER BY posts.date DESC LIMIT $${values.length + 1} OFFSET $${
      values.length + 2
    }`;

    values.push(safeLimit, offset);

    // 6) Execute the main query (ดึงข้อมูลของบทความ)
    const result = await connectionPool.query(query, values);

    // 7) สร้าง Query สำหรับนับจำนวนทั้งหมดตามเงื่อนไข พื่อใช้สำหรับ pagination metadata
    let countQuery = `
        SELECT COUNT(*)
        FROM posts
        INNER JOIN categories ON posts.category_id = categories.id
        INNER JOIN statuses ON posts.status_id = statuses.id
        WHERE statuses.id = 2 
      `;
    let countValues = values.slice(0, -2); // ลบค่า limit และ offset ออกจาก values

    if (category && keyword) {
      countQuery += `
          AND categories.name ILIKE $1 
          AND (posts.title ILIKE $2 OR posts.description ILIKE $2 OR posts.content ILIKE $2)
        `;
    } else if (category) {
      countQuery += " AND categories.name ILIKE $1";
    } else if (keyword) {
      countQuery += `
          AND (posts.title ILIKE $1 
          OR posts.description ILIKE $1 
          OR posts.content ILIKE $1)
        `;
    }

    const countResult = await connectionPool.query(countQuery, countValues);
    const totalPosts = Number(countResult.rows[0].count);

    // 8) สร้าง response พร้อมข้อมูลการแบ่งหน้า (pagination)
    const results = {
      totalPosts,
      totalPages: Math.ceil(totalPosts / safeLimit),
      currentPage: safePage,
      limit: safeLimit,
      posts: result.rows,
    };
    // เช็คว่ามีหน้าถัดไปหรือไม่
    if (offset + safeLimit < totalPosts) {
      results.nextPage = safePage + 1;
    }
    // เช็คว่ามีหน้าก่อนหน้าหรือไม่
    if (offset > 0) {
      results.previousPage = safePage - 1;
    }
    // 9) Return ตัว Response กลับไปหา Client ว่าสร้างสำเร็จ
    return res.status(200).json(results);
  } catch {
    return res.status(500).json({
      message: "Server could not read post because database issue",
    });
  }
});

// get all posts including draft
postRouter.get("/admin", protectAdmin, async (req, res) => {
  try {
    // Query all posts with their category and status for admin view
    const query = `
      SELECT 
          posts.*, 
          categories.name AS category, 
          statuses.status
      FROM posts
      INNER JOIN categories ON posts.category_id = categories.id
      INNER JOIN statuses ON posts.status_id = statuses.id
      ORDER BY posts.date DESC;
    `;

    // Execute the query
    const result = await connectionPool.query(query);

    // Return all posts as the response
    return res.status(200).json({
      posts: result.rows,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server could not read posts because of a database issue",
    });
  }
});

postRouter.get("/:postId", async (req, res) => {
  // ลอจิกในอ่านข้อมูลโพสต์ด้วย Id ในระบบ
  // 1) Access ตัว Endpoint Parameter ด้วย req.params
  const postIdFromClient = req.params.postId;

  try {
    // 2) เขียน Query เพื่ออ่านข้อมูลโพสต์ ด้วย Connection Pool
    const results = await connectionPool.query(
      `
    SELECT 
        posts.*, 
        categories.name AS category, 
        statuses.status
    FROM posts
    INNER JOIN categories ON posts.category_id = categories.id
    INNER JOIN statuses ON posts.status_id = statuses.id
    WHERE posts.id = $1
    AND statuses.id = 2 
  `,
      [postIdFromClient] // status id = 2 means showing only publish post
    );

    // เพิ่ม Conditional logic ว่าถ้าข้อมูลที่ได้กลับมาจากฐานข้อมูลเป็นค่า false (null / undefined)
    if (!results.rows[0]) {
      return res.status(404).json({
        message: `Server could not find a requested post (post id: ${postIdFromClient})`,
      });
    }

    // 3) Return ตัว Response กลับไปหา Client
    return res.status(200).json(results.rows[0]);
  } catch (err) {
    return res.status(500).json({
      message: `Server could not read post because database issue`,
    });
  }
});

postRouter.get("/admin/:postId", protectAdmin, async (req, res) => {
  // ลอจิกในอ่านข้อมูลโพสต์ด้วย Id ในระบบ
  // 1) Access ตัว Endpoint Parameter ด้วย req.params
  const postIdFromClient = req.params.postId;

  try {
    // 2) เขียน Query เพื่ออ่านข้อมูลโพสต์ ด้วย Connection Pool
    const results = await connectionPool.query(
      `
    SELECT 
        posts.*, 
        categories.name AS category, 
        statuses.status
    FROM posts
    INNER JOIN categories ON posts.category_id = categories.id
    INNER JOIN statuses ON posts.status_id = statuses.id
    WHERE posts.id = $1
  `,
      [postIdFromClient] // status id = 2 means showing only publish post
    );

    // เพิ่ม Conditional logic ว่าถ้าข้อมูลที่ได้กลับมาจากฐานข้อมูลเป็นค่า false (null / undefined)
    if (!results.rows[0]) {
      return res.status(404).json({
        message: `Server could not find a requested post (post id: ${postIdFromClient})`,
      });
    }

    // 3) Return ตัว Response กลับไปหา Client
    return res.status(200).json(results.rows[0]);
  } catch {
    return res.status(500).json({
      message: `Server could not read post because database issue`,
    });
  }
});

postRouter.put(
  "/:postId",
  [imageFileUpload, protectAdmin],
  async (req, res) => {
    const postIdFromClient = req.params.postId;
    const updatedPost = { ...req.body, date: new Date() };

    // Define the Supabase Storage bucket name
    const bucketName = "my-personal-blog";

    try {
      let publicUrl = updatedPost.image; // Default to the existing image URL
      const file = req.files?.imageFile?.[0]; // Check if a new file is attached

      if (file) {
        // If a new image file is attached, upload it to Supabase
        const filePath = `posts/${Date.now()}`; // Unique file path

        const { data, error } = await supabase.storage
          .from(bucketName)
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false, // Prevent overwriting existing files
          });

        if (error) {
          throw error; // If Supabase upload fails
        }

        // Get the public URL of the uploaded file
        const response = supabase.storage
          .from(bucketName)
          .getPublicUrl(data.path);

        if (response.error) {
          throw response.error;
        }

        publicUrl = response.data.publicUrl;
      }

      // Update the database
      const result = await connectionPool.query(
        `
          UPDATE posts
          SET title = $2,
              image = $3,
              category_id = $4,
              description = $5,
              content = $6,
              status_id = $7,
              date = $8
          WHERE id = $1
        `,
        [
          postIdFromClient,
          updatedPost.title,
          publicUrl, // Updated image URL
          parseInt(updatedPost.category_id),
          updatedPost.description,
          updatedPost.content,
          parseInt(updatedPost.status_id),
          updatedPost.date,
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          message: `Server could not find a requested post to update (post id: ${postIdFromClient})`,
        });
      }

      return res.status(200).json({
        message: "Updated post successfully",
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        message: `Server could not update post due to an error`,
      });
    }
  }
);

postRouter.delete("/:postId", protectAdmin, async (req, res) => {
  // ลอจิกในการลบข้อมูลโพสต์ด้วย Id ในระบบ

  // 1) Access ตัว Endpoint Parameter ด้วย req.params
  const postIdFromClient = req.params.postId;

  try {
    // 2) เขียน Query เพื่อลบข้อมูลโพสต์ ด้วย Connection Pool
    const result = await connectionPool.query(
      `DELETE FROM posts
         WHERE id = $1`,
      [postIdFromClient]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: `Server could not find a requested post to delete (post id: ${postIdFromClient})`,
      });
    }

    // 3) Return ตัว Response กลับไปหา Client
    return res.status(200).json({
      message: "Deleted post successfully",
    });
  } catch {
    return res.status(500).json({
      message: `Server could not delete post because database connection`,
    });
  }
});

export default postRouter;
