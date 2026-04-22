const getFileName = (url) => {
  try {
    return url.split("/").pop().split("?")[0];
  } catch {
    return "file";
  }
};

module.exports = {
    getFileName,
};