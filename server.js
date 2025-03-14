const express = require("express");
const cors = require("cors");
const multer = require("multer");
const unzipper = require("unzipper");
const fs = require("fs-extra");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());

// Define directories
const uploadDir = path.join(__dirname, "uploads");
const processedDir = path.join(__dirname, "processed");

fs.ensureDirSync(uploadDir);
fs.ensureDirSync(processedDir);

// Multer configuration for ZIP uploads
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// ✅ Extract ZIP and Fix Nested Structure
const extractZip = async (zipFilePath, extractPath) => {
  const tempExtractPath = path.join(uploadDir, "temp_extracted");

  // ✅ Clean temp folder
  fs.removeSync(tempExtractPath);
  fs.ensureDirSync(tempExtractPath);

  // ✅ Extract to temp folder
  await fs.createReadStream(zipFilePath)
    .pipe(unzipper.Extract({ path: tempExtractPath }))
    .promise();

  // ✅ Fix nested issue if exists
  const extractedItems = fs.readdirSync(tempExtractPath);
  let rootFolder = tempExtractPath;

  if (extractedItems.length === 1) {
    const firstItemPath = path.join(tempExtractPath, extractedItems[0]);
    if (fs.statSync(firstItemPath).isDirectory()) {
      const subItems = fs.readdirSync(firstItemPath);
      if (subItems.length === 1 && subItems[0] === extractedItems[0]) {
        rootFolder = path.join(firstItemPath, subItems[0]);
      } else {
        rootFolder = firstItemPath;
      }
    }
  }

  // ✅ Move to final `processed/` directory
  fs.moveSync(rootFolder, extractPath, { overwrite: true });

  // ✅ Cleanup
  fs.removeSync(tempExtractPath);
};

// ✅ Process Uploaded ZIP
app.post("/upload", upload.single("zipFile"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const zipFilePath = path.join(uploadDir, req.file.filename);
  const baseName = path.parse(req.file.filename).name;
  const extractPath = path.join(processedDir, baseName);

  try {
    // ✅ Clear previous processed data
    fs.removeSync(extractPath);

    // ✅ Extract and fix nesting
    await extractZip(zipFilePath, extractPath);

    // ✅ Locate necessary folders
    const viewFolderPath = path.join(extractPath, "view");
    const assetsFolderPath = path.join(extractPath, "assets");
    const jsonFolderPath = path.join(extractPath, "assets/JSON"); // Path to JSON folder
    const studioConfigPath = path.join(jsonFolderPath, "studioConfigs.json");

    if (fs.existsSync(viewFolderPath)) {
      const htmlFiles = fs.readdirSync(viewFolderPath);

      htmlFiles.forEach((htmlFile) => {
        if (htmlFile.endsWith(".html")) {
          const fileNameWithoutExt = path.parse(htmlFile).name;
          const newFolderPath = path.join(processedDir, fileNameWithoutExt);

          // ✅ Ensure the new folder exists
          fs.ensureDirSync(newFolderPath);

          // ✅ Create `view/` and copy the HTML file
          fs.ensureDirSync(path.join(newFolderPath, "view"));
          fs.copySync(path.join(viewFolderPath, htmlFile), path.join(newFolderPath, "view", htmlFile));

          // ✅ Copy `assets/` folder (excluding `screenshots/`)
          if (fs.existsSync(assetsFolderPath)) {
            const newAssetsFolder = path.join(newFolderPath, "assets");
            fs.ensureDirSync(newAssetsFolder);

            fs.copySync(assetsFolderPath, newAssetsFolder, {
              overwrite: true,
              filter: (src) => !src.includes("screenshots"),
            });

            // ✅ Copy only relevant screenshots
            const screenshotsFolderPath = path.join(assetsFolderPath, "screenshots");
            const newScreenshotsFolder = path.join(newAssetsFolder, "screenshots");
            fs.ensureDirSync(newScreenshotsFolder);

            if (fs.existsSync(screenshotsFolderPath)) {
              const screenshotFiles = fs.readdirSync(screenshotsFolderPath);

              screenshotFiles.forEach((screenshot) => {
                if (screenshot.includes(fileNameWithoutExt)) {
                  fs.copySync(
                    path.join(screenshotsFolderPath, screenshot),
                    path.join(newScreenshotsFolder, screenshot)
                  );
                }
              });
            }
          }

          // ✅ Modify `studioConfigs.json` to keep only the relevant object in the correct folder
          if (fs.existsSync(studioConfigPath)) {
            const rawData = fs.readFileSync(studioConfigPath, "utf8");
            let jsonData = JSON.parse(rawData);

            if (jsonData.pages && Array.isArray(jsonData.pages)) {
              // ✅ Find the object where "PageName" matches the HTML filename
              const matchedPage = jsonData.pages.find(page => page.PageName === fileNameWithoutExt);

              if (matchedPage) {
                const newStudioConfigPath = path.join(newFolderPath, "assets", "JSON", "studioConfigs.json");
                fs.ensureDirSync(path.dirname(newStudioConfigPath)); // Ensure the directory exists


                // ✅ Overwrite JSON to contain only the matched object inside the generated folder
                fs.writeFileSync(newStudioConfigPath, JSON.stringify(matchedPage, null, 2), "utf8");
              }
            }
          }

          // ✅ Modify `skinnerConfigs.json` to keep only the relevant object in the correct folder
          const skinnerConfigPath = path.join(jsonFolderPath, "skinnerConfigs.json");

          if (fs.existsSync(skinnerConfigPath)) {
            const rawSkinnerData = fs.readFileSync(skinnerConfigPath, "utf8");
            let skinnerData = JSON.parse(rawSkinnerData);

            if (skinnerData.pages && Array.isArray(skinnerData.pages)) {
              // ✅ Find the object where "PageName" matches the HTML filename
              const matchedSkinnerPage = skinnerData.pages.find(page => page.PageName === fileNameWithoutExt);

              if (matchedSkinnerPage) {
                const newSkinnerConfigPath = path.join(newFolderPath, "assets", "JSON", "skinnerConfigs.json");
                fs.ensureDirSync(path.dirname(newSkinnerConfigPath)); // Ensure directory exists

                // ✅ Write the filtered object inside the correct folder
                fs.writeFileSync(newSkinnerConfigPath, JSON.stringify(matchedSkinnerPage, null, 2), "utf8");

              }
            }
          }

        }
      });
    }

    res.json({ message: "✅ File uploaded and processed successfully!" });
  } catch (err) {
    res.status(500).json({ error: "Error processing file", details: err.message });
  }
});

// ✅ Start Server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
