import "dotenv/config";
import express from "express";
import enrollRouter from "./routes/enroll.js";
import loginRouter from "./routes/login.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/", enrollRouter);
app.use("/", loginRouter);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
