// After each test file: its browsers closed.
import { afterAll } from "vite-plus/test";
import { closeBrowsers } from "./helpers.ts";

afterAll(closeBrowsers);
