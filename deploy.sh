#!/bin/bash

# starpush.io Automated Deployment Script
# Usage: ./deploy.sh [github-username]

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "🚀 starpush.io Deployment Script"
echo "=================================="
echo ""

# Get inputs
if [ -z "$1" ]; then
  echo "Enter your GitHub username (from https://github.com/settings/profile):"
  read GITHUB_USERNAME
else
  GITHUB_USERNAME=$1
fi

echo ""
echo "Configuration:"
echo "  GitHub Username: $GITHUB_USERNAME"
echo "  API keys: configure them securely in the Render dashboard"
echo ""

# Step 1: Prepare git repo
echo "📦 Preparing Git repository..."
git add -u
git commit -m "Deploy starpush.io $(date +%Y-%m-%d)" 2>/dev/null || echo "  (No changes to commit)"

# Step 2: Create GitHub repo URL
REPO_URL="https://github.com/$GITHUB_USERNAME/starpush.io.git"
echo "🔗 Repository URL: $REPO_URL"

# Step 3: Update remote
echo "Updating git remote..."
git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL"

# Step 4: Push to GitHub
echo "📤 Pushing code to GitHub..."
git push -u origin main || {
  echo ""
  echo "⚠️  GitHub push failed. Options:"
  echo ""
  echo "Option 1: Use GitHub CLI (recommended)"
  echo "  gh auth login"
  echo "  gh repo create starpush.io --public --source=. --push"
  echo ""
  echo "Option 2: Create repo manually at https://github.com/new"
  echo "  Then run: git push -u origin main"
  echo ""
  exit 1
}

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "Next steps to deploy on Render:"
echo "1. Go to https://dashboard.render.com/"
echo "2. Click 'New +' → 'Web Service'"
echo "3. Select your 'starpush.io' repository"
echo "4. Set environment variables:"
echo "   ANTHROPIC_API_KEY = set securely in the Render dashboard"
echo "   NODE_ENV = production"
echo "5. Click 'Deploy'"
echo ""
echo "Your app will be live in 2-5 minutes!"
