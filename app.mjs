import express from "express";
import cors from "cors";
import connectionPool from "./utils/db.mjs";

const app = express();
const port = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello TechUp!");
});

app.post("/posts", async (req, res) => {
  // ลอจิกในการเก็บข้อมูลของโพสต์ลงในฐานข้อมูล

  // 1) Access ข้อมูลใน Body จาก Request ด้วย req.body
  const newPost = req.body;

  // 2) เขียน Query เพื่อ Insert ข้อมูลโพสต์ ด้วย Connection Pool
  try {
    const query = `insert into posts (title, image, category_id, description, content, status_id)
    values ($1, $2, $3, $4, $5, $6)`;

    const values = [
      newPost.title,
      newPost.image,
      newPost.category_id,
      newPost.description,
      newPost.content,
      newPost.status_id,
    ];

    await connectionPool.query(query, values);
  } catch {
    return res.status(500).json({
      message: `Server could not create post because database connection`,
    });
  }

  // 3) Return ตัว Response กลับไปหา Client ว่าสร้างสำเร็จ
  return res.status(201).json({ message: "Created post successfully" });
});

app.listen(port, () => {
  console.log(`Server is running at ${port}`);
});
