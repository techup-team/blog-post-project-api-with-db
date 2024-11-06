import express from "express";
import cors from "cors";
import postRouter from "./apps/postRouter.mjs";

const app = express();
const port = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello TechUp!");
});

app.use("/posts", postRouter);

app.listen(port, () => {
  console.log(`Server is running at ${port}`);
});
