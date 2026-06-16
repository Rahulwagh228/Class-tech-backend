import express from "express";
import { chatHandler } from "../controllers/kobi/chat.js";

const KobiRouter = express.Router();

KobiRouter.post("/chat", chatHandler);

export default KobiRouter;