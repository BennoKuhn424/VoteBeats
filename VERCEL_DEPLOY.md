# VoteBeats – Deploy to Vercel + Render (In-Depth Guide)

This guide deploys:
- **Frontend** → Vercel (stable URL, QR codes work forever)
- **Backend** → Render (free tier, runs 24/7)

---

# Part 1: Push Your Code to GitHub

## 1.1 Create a GitHub account (if you don't have one)

1. Open a browser and go to **https://github.com**
2. Click **Sign up** (top right)
3. Enter your email, create a password, choose a username
4. Verify your email if prompted

---

## 1.2 Create a new repository

1. After logging in, look at the **top right** of the page
2. Click the **+** button (or your profile icon)
3. Click **New repository**
4. On the "Create a new repository" page:
   - **Repository name:** Type `VoteBeats` (exactly, no spaces)
   - **Description:** Optional (e.g. "Music voting app for venues")
   - **Visibility:** Choose **Private** (recommended) or **Public**
   - **Important:** Do **NOT** check "Add a README file" (your project already has code)
   - **Important:** Do **NOT** add .gitignore or license – we're pushing existing code
5. Click the green **Create repository** button
6. You'll see a page with setup instructions – **don't follow those yet**; use the steps below instead

---

## 1.3 Check if Git is installed

1. Open **PowerShell** (Win key → type `PowerShell` → Enter)
2. Run: `git --version`
3. If you see a version number (e.g. `git version 2.x.x`), you're good
4. If you get an error, install Git: https://git-scm.com/download/win

---

## 1.4 Push your code to GitHub

1. In PowerShell, go to your project folder:
   ```
   cd c:\Users\benno\VoteBeats
   ```

2. Initialize Git (only if this folder has never used git before):
   ```
   git init
   ```
   If you see "Reinitialized" or "already exists", that's fine.

3. Add all files:
   ```
   git add .
   ```

4. Create your first commit:
   ```
   git commit -m "Initial commit"
   ```

5. Set the default branch name:
   ```
   git branch -M main
   ```

6. Connect to your GitHub repo (replace `YOUR_USERNAME` with your GitHub username):
   ```
   git remote add origin https://github.com/BennoKuhn424/VoteBeats.git
   ```
   Example: if your username is `bennok2200`, use:
   ```
   git remote add origin https://github.com/bennok2200/VoteBeats.git
   ```

7. If you get "remote origin already exists", remove it first:
   ```
   git remote remove origin
   ```
   Then run the `git remote add origin` command again.

8. Push your code:
   ```
   git push -u origin main
   ```

9. You may be asked to log in:
   - Use your GitHub username and password (or a **Personal Access Token** if you have 2FA)
   - To create a token: GitHub → Settings → Developer settings → Personal access tokens → Generate new token

10. When the push succeeds, refresh your GitHub repo page – you should see all your files.

---

# Part 2: Deploy Backend to Render

## 2.1 Create a Render account

1. Go to **https://render.com**
2. Click **Get Started** or **Sign Up**
3. Choose **Sign up with GitHub**
4. Authorize Render to access your GitHub
5. You’ll land on the Render dashboard

---

## 2.2 Create a Web Service

1. On the Render dashboard, click **New +** (top right)
2. Select **Web Service**
3. You may see "Connect a repository":
   - If your VoteBeats repo is listed, click **Connect** next to it
   - If not, click **Configure account** and grant Render access to your GitHub account / VoteBeats repo
4. Once VoteBeats is connected, click **Connect** next to it

---

## 2.3 Configure the Web Service

Fill in the form as follows:

| Field | Value |
|-------|-------|
| **Name** | `votebeats-api` (or any name you like; this becomes part of the URL) |
| **Region** | Choose the closest to you (e.g. **Frankfurt** for Europe, **Oregon** for US West) |
| **Branch** | `main` |
| **Root Directory** | **Important:** Click in the box and type `server` (this tells Render to use the server folder) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** (scroll down if needed) |

---

## 2.4 Add environment variables

1. Scroll down to the **Environment Variables** section
2. Click **Add Environment Variable**
3. Add each variable one by one:

| Key | Value | Notes |
|-----|-------|-------|
| `PORT` | `3000` | Render sets this automatically, but we add it to be safe |
| `JWT_SECRET` | (random string) | e.g. `mySecretKey123xyz789abc` – make it long and random |
| `APPLE_TEAM_ID` | Your team ID | e.g. `3W53F2TT56` (from your Apple Developer account) |
| `APPLE_KEY_ID` | Your key ID | e.g. `X2Q5S7J5ZM` |
| `APPLE_MUSIC_KEY` | (see below) | Full contents of your .p8 file |
| `PUBLIC_URL` | Leave empty for now | Add after Vercel deploy |
| `YOCO_SECRET_KEY` | Your Yoco key | e.g. `sk_test_c7ca76b9DLzaV0k56af446c9eb2d` |
| `VENUE_EARNINGS_PERCENT` | `80` | |
| `ADMIN_SECRET` | Any secret string | e.g. `myAdminPassword123` |

### How to add APPLE_MUSIC_KEY

1. Open File Explorer and go to `c:\Users\benno\VoteBeats\server\`
2. Right‑click `AuthKey_X2Q5S7J5ZM.p8` → **Open with** → **Notepad**
3. Select all (Ctrl+A) and copy (Ctrl+C)
4. The content looks like:
   ```
   -----BEGIN PRIVATE KEY-----
   MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
   ...more lines...
   -----END PRIVATE KEY-----
   ```
5. In Render, for `APPLE_MUSIC_KEY`, paste the entire content into the Value field
6. Some platforms want newlines as `\n`. If Render shows an error later, try replacing each line break with `\n` (you can do this in Notepad by replacing line breaks with `\n`)

---

## 2.5 Deploy

1. Click the blue **Create Web Service** button at the bottom
2. Render will start building – you’ll see logs in the **Logs** tab
3. Wait until you see something like **Your service is live at https://votebeats-api.onrender.com**
4. Copy that URL (without `/api` at the end) – you’ll need it for Vercel  
   Example: `https://votebeats-api.onrender.com`

---

## 2.6 If the deploy fails

- **"Build failed"** – Check the logs; often it’s missing env vars or wrong Root Directory
- **"Apple Music token" errors** – Double‑check `APPLE_MUSIC_KEY`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`
- **"Cannot find module"** – Ensure Root Directory is `server` (no leading slash)

---

# Part 3: Deploy Frontend to Vercel

## 3.1 Create a Vercel account

1. Go to **https://vercel.com**
2. Click **Sign Up** or **Continue with GitHub**
3. Sign in with your GitHub account and authorize Vercel

---

## 3.2 Import the project

1. On the Vercel dashboard, click **Add New…** → **Project**
2. You should see a list of your GitHub repositories
3. Find **VoteBeats** and click **Import** (or **Import Project**)

---

## 3.3 Configure the project

1. **Project Name:** Keep `VoteBeats` (or change it)
2. **Framework Preset:** Should detect **Vite** automatically. If not, choose **Vite**
3. **Root Directory:**  
   - Click **Edit** next to it  
   - Type `client`  
   - Confirm (this is the folder with the React app)
4. **Build and Output Settings:**
   - Build Command: `npm run build` (default)
   - Output Directory: `dist` (default)
   - Install Command: `npm install` (default)

---

## 3.4 Add environment variables

1. Expand **Environment Variables**
2. Add the first variable:
   - **Key:** `VITE_API_URL`
   - **Value:** `https://YOUR-RENDER-URL.onrender.com/api`  
     Replace `YOUR-RENDER-URL` with your actual Render URL from Part 2.  
     Example: `https://votebeats-api.onrender.com/api`
3. Add the second variable:
   - **Key:** `VITE_PUBLIC_URL`
   - **Value:** Leave **empty** for now – we’ll set it after deploy

---

## 3.5 Deploy

1. Click **Deploy**
2. Wait for the build to finish (usually 1–2 minutes)
3. When it’s done, you’ll see **Congratulations!** and a URL like `https://votebeats-abc123.vercel.app`
4. Copy that URL – you’ll use it for Apple Developer and for `VITE_PUBLIC_URL`

---

## 3.6 If the build fails

- **"Cannot find module"** – Ensure Root Directory is `client`
- **"API_URL" or network errors in browser** – Ensure `VITE_API_URL` ends with `/api` and uses your real Render URL

---

# Part 4: Connect Backend and Frontend

## 4.1 Update Render (backend)

1. Go back to **Render** → open your **votebeats-api** service
2. Click **Environment** in the left sidebar
3. Find `PUBLIC_URL`:
   - If it’s empty, click **Add Environment Variable**
   - **Key:** `PUBLIC_URL`
   - **Value:** Your Vercel URL, e.g. `https://votebeats-abc123.vercel.app`  
     (no trailing slash)
4. Click **Save Changes**
5. Render may auto‑redeploy; if not, go to **Manual Deploy** → **Deploy latest commit**

---

## 4.2 Update Vercel (frontend)

1. Go to **Vercel** → open your **VoteBeats** project
2. Click **Settings** (top menu)
3. Click **Environment Variables** in the sidebar
4. Edit `VITE_PUBLIC_URL` (or add it if you left it empty):
   - **Value:** Same as above, e.g. `https://votebeats-abc123.vercel.app`
5. Click **Save**
6. Go to **Deployments**
7. Find the latest deployment → click the **⋮** menu → **Redeploy**
8. Confirm **Redeploy** – this rebuilds with the new variable

---

# Part 5: Apple Developer Configuration

1. Go to **https://developer.apple.com**
2. Sign in with your Apple ID
3. Click **Account** (or go to **Certificates, Identifiers & Profiles**)
4. In the sidebar, click **Identifiers**
5. Make sure the filter is **Services IDs** (dropdown at the top)
6. Click **VoteBeats Web** (or your Services ID)
7. Find **Sign In with Apple** and click **Configure**
8. In **Domains and Subdomains**:
   - Clear any old domain (e.g. the trycloudflare.com one)
   - Add: `votebeats-abc123.vercel.app` (your actual Vercel hostname, **no** `https://`)
9. In **Return URLs**:
   - Clear any old URL
   - Add: `https://votebeats-abc123.vercel.app/`  
     (with `https://` and a trailing `/`)
10. Click **Next** → **Done** → **Continue** → **Save**

---

# Part 6: Test Everything

1. Open your Vercel URL in a browser (e.g. `https://votebeats-abc123.vercel.app`)
2. Go to the home page and enter a venue code (or create a venue)
3. Open the **Venue Player** (e.g. `/venue/player/YOUR_CODE`)
4. Sign in with Apple Music and test full song playback
5. Open the **Venue Dashboard** and view the QR code
6. Scan the QR code with your phone – it should open the voting page

---

# Troubleshooting

| Problem | What to try |
|---------|-------------|
| QR code opens but page doesn’t load | Check `VITE_PUBLIC_URL` matches your Vercel URL and redeploy |
| Songs still stop at 30 seconds | Update Apple Developer with your Vercel domain (Part 5) |
| "Failed to fetch" or API errors | Check `VITE_API_URL` in Vercel and that the Render service is running |
| Render service "suspended" | Free tier sleeps after ~15 min of inactivity; it wakes on first request (may take 30–60 seconds) |
| Build fails on Render | Check logs; ensure Root Directory is `server` and env vars are set |
| Build fails on Vercel | Ensure Root Directory is `client` and `VITE_API_URL` is set |

---

# Summary

- **GitHub:** Your code is stored and connected to Render and Vercel
- **Render:** Runs your backend 24/7; URL like `https://votebeats-api.onrender.com`
- **Vercel:** Hosts your frontend; URL like `https://votebeats-abc123.vercel.app`
- **Apple Developer:** Configured once with your Vercel domain
- **Result:** Stable URLs, no reconfiguring when you restart your computer
