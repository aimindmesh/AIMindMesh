#!/bin/bash
# AIMindMesh Admin Mobile - Atomic Build Script

echo "🚀 Starting Production Build sequence..."

# 1. Clean previous build
rm -rf dist

# 2. Type Check & Vite Build
echo "📦 Building web assets..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Web build successful."
    
    # 3. Capacitor Sync
    echo "🔄 Syncing with Android..."
    npx cap sync android
    
    echo "✨ Build and Sync complete! Use ./publish_android.sh to open Android Studio."
else
    echo "❌ Build failed. Check errors above."
    exit 1
fi
