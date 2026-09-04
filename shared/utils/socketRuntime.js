/**
 * Socket.IO — الإطلاق المحدود Instance واحد.
 * لا نركّب Redis adapter في هذه المرحلة (مخاطر غير ضرورية).
 */

function socketSingleInstanceRequired() {
  const v = String(process.env.SOCKET_IO_SINGLE_INSTANCE_REQUIRED || "true")
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function getSocketRuntimeStatus() {
  const single = socketSingleInstanceRequired();
  return {
    mode: single ? "single-instance" : "multi-instance-unsafe",
    adapter: "memory",
    redis_adapter: false,
    single_instance_required: single,
  };
}

module.exports = { socketSingleInstanceRequired, getSocketRuntimeStatus };
