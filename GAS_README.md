# Google Drive Search Backend (Google Apps Script)

To enable the "Search by Code" functionality after your event ends, follow these steps to set up the Google Apps Script bridge.

## 1. Prepare Google Drive
1. Create a new folder on your Google Drive (e.g., "iRISE Photobooth Media").
2. Upload your event videos and photo strips to this folder. Ensure they are named `CODE.mp4` (e.g., `A7X9P.mp4`) and `CODE.png` (e.g., `A7X9P.png`) respectively.
3. Right-click the folder -> **Share** -> Change access to **"Anyone with the link"** as **Viewer**.
4. Copy the **Folder ID** from the URL (the string of characters after `folders/`).

## 2. Create the Script
1. Go to [script.google.com](https://script.google.com).
2. Click **New Project**.
3. Replace the default code with the script below.
4. Replace `'YOUR_FOLDER_ID_HERE'` with the Folder ID you copied.

```javascript
function doGet(e) {
  const code = e.parameter.code;
  const folderId = 'YOUR_FOLDER_ID_HERE'; // <--- PASTE YOUR FOLDER ID HERE
  
  if (!code) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "No code provided" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // OPTIMIZATION 1: Use DriveApp.searchFiles() with a direct index query instead of getFilesByName().
    // getFilesByName() gets extremely slow as the number of files in the folder grows.
    const videoFiles = DriveApp.searchFiles("title = '" + code + ".mp4' and '" + folderId + "' in parents and trashed = false");
    const photoFiles = DriveApp.searchFiles("title = '" + code + ".png' and '" + folderId + "' in parents and trashed = false");
    
    let videoUrl = null;
    let photoUrl = null;
    
    // OPTIMIZATION 2: Removed file.setSharing().
    // Setting sharing permissions on every single search request adds 2-6 seconds of delay. 
    // Since the parent folder is already shared (Step 1), the files inherit the permissions automatically.
    if (videoFiles.hasNext()) {
      videoUrl = "https://drive.google.com/uc?export=view&id=" + videoFiles.next().getId();
    }
    
    if (photoFiles.hasNext()) {
      photoUrl = "https://drive.google.com/uc?export=view&id=" + photoFiles.next().getId();
    }
    
    if (videoUrl || photoUrl) {
      return ContentService.createTextOutput(JSON.stringify({ 
        success: true, 
        videoUrl: videoUrl,
        photoUrl: photoUrl
      })).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Files not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

## 3. Deploy as Web App
1. Click **Deploy** -> **New Deployment**.
2. Select type: **Web App**.
3. Set "Execute as": **Me**.
4. Set "Who has access": **Anyone**.
5. Click **Deploy**.
6. Copy the **Web App URL**.

## 4. Update view.html
1. Open `public/view.html` in your editor.
2. Find the line: `const SCRIPT_URL = '...';`
3. Paste your **Web App URL** there.
4. Save and deploy your Firebase site.

---

### Why this works:
- **Cloudflare Tunnel Off:** Once you disconnect your laptop, the QR codes point to a dead link.
- **Firebase On:** Your landing page and `view.html` are hosted on Firebase, so they stay alive.
- **Search Logic:** When a user enters their 5-char code, `view.html` asks Google Apps Script to find the video in your Drive folder.
- **Direct Playback:** The script returns a special Drive URL that allows the browser to play the video directly inside the card.
