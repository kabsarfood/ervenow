/** PlatformAPI wrapper — all admin HTTP calls go through here */
import { app } from "./shared.js";

export function adminApi(path, options) {
  return app.PlatformAPI.api(path, options);
}

export function adminApiUrl(path) {
  return app.PlatformAPI.apiUrl(path);
}

app.adminApi = adminApi;
app.adminApiUrl = adminApiUrl;
