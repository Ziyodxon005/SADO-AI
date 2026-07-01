// Vercel serverless entry point
// server.ts dagi createApp() ni eksport qilib, API so'rovlarini qayta ishlaydi
import { createApp } from "../server.js";

const app = createApp();

export default app;
