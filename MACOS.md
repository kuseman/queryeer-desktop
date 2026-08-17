# macOS Gatekeeper & Unsigned Apps

Electron apps that aren't notarized by Apple are blocked by Gatekeeper. Queryeer builds are ad-hoc signed to preserve application integrity but are not Developer ID signed or notarized, so macOS users need to manually bypass this restriction.

---

## Method 1: Clear the Quarantine Attribute (Recommended)

Open **Terminal** and run:

```bash
xattr -d com.apple.quarantine /Applications/Queryeer.app
```

Replace the path with the actual app location — you can also drag-and-drop the app from Finder into the Terminal window to auto-fill the path.

After clearing the quarantine flag, double-click the app to launch normally.

---

## Method 2: Control-Click (Bypass Gatekeeper)

1. Open **Finder** → **Applications**
2. Hold `Control` and click the **Queryeer** icon
3. Select **Open** from the context menu
4. Click **Open** on the warning prompt

The app is now saved as a trusted exception and will open normally in the future.

---

## Method 3: System Settings — "Open Anyway"

If you already attempted to open the app and Gatekeeper blocked it:

1. **Apple menu** → **System Settings**
2. **Privacy & Security** → scroll down to **Security**
3. Look for the message *"Queryeer was blocked to protect your Mac"*
4. Click **Open Anyway**, then enter your password

---

## Disable Gatekeeper (Not Recommended)

For development machines, Gatekeeper can be disabled entirely:

```bash
sudo spctl --master-disable
```

This adds an "Anywhere" option under **System Settings** → **Privacy & Security**.

---

## Video Walkthrough

[![macOS Gatekeeper bypass](https://img.youtube.com/vi/zZEBE4b_xiQ/0.jpg)](https://www.youtube.com/watch?v=zZEBE4b_xiQ)
