<div align="center">

# 🎨 Grok Spirit

*Grok Imagen Parameter Editor - Chrome Extension*

[English](README.md) | [中文](README_zh.md)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/logaoplejbodjhnogdndgllocmpmlako?label=Chrome%20Web%20Store&color=blue)](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/logaoplejbodjhnogdndgllocmpmlako?label=Active%20Users&color=green)](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako)
[![GitHub stars](https://img.shields.io/github/stars/OtokoNoIzumi/grok_spirit?color=yellow&label=GitHub%20Stars)](https://github.com/OtokoNoIzumi/grok_spirit/stargazers)
[![GitHub license](https://img.shields.io/github/license/OtokoNoIzumi/grok_spirit?color=blue)](https://github.com/OtokoNoIzumi/grok_spirit/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/OtokoNoIzumi/grok_spirit)](https://github.com/OtokoNoIzumi/grok_spirit/commits)

**A Chrome extension that reveals and allows editing of Grok Imagen prompt parameters**

![Grok Spirit Screenshot](https://otokonoizumi.github.io/media/grok%20spirit.png)

[🏪 Chrome Web Store](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako) · [📋 Usage Guide](#usage-guide) · [🛠️ Local Installation](#local-installation) · [❓ Issues](https://github.com/OtokoNoIzumi/grok_spirit/issues)

</div>

---

## ✨ Features

- 🎯 **Complete Structure View** - View complete Grok Imagen prompt structure
- ⚙️ **Direct Editing** - Edit parameters directly in the interface
- 💾 **Video Download** - Download videos with matching metadata
- 🔧 **Preset Support** - Support for both custom and preset prompts
- 🌙 **Dark Mode Support** - Automatically syncs with Grok's theme (light/dark)
- 🎬 **Metadata Processing** - Python tool for batch video metadata embedding

## 🚀 Quick Start

### Chrome Web Store Installation (Recommended)

Click the button below to install directly from Chrome Web Store:

[Chrome Web Store Installation](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako)

### Local Installation

1. **Download Project**
   ```bash
   git clone https://github.com/OtokoNoIzumi/grok_spirit.git
   # or download ZIP file and extract
   ```

2. **Load Extension**
   - Open Chrome browser and visit `chrome://extensions/`
   - Enable "Developer mode" in the top right corner
   - Click "Load unpacked extension"
   - Select the project directory

3. **Start Using**
   - Visit grok.com/imagine
   - The extension will automatically activate and show parameter editing interface

## 📖 Usage Guide

### Basic Operations

1. **🔍 Parameter Discovery**
   - Visit grok.com/imagine and generate a video
   - The extension automatically captures and displays the complete prompt structure used for generation
   - View detailed parameters including camera settings, lighting, motion, and scene composition

2. **✏️ Parameter Editing**
   - Modify any parameter value directly in the interface
   - Experiment with different camera angles, lighting conditions, and motion settings
   - Changes are applied in real-time for immediate testing

3. **💾 Content Management**
   - Download generated videos with matching metadata filenames
   - Save and reuse your favorite parameter combinations
   - Build a personal library of effective prompt structures

4. **🌙 Theme Support**
   - Automatically detects and syncs with Grok's current theme
   - Seamless experience in both light and dark modes
   - All UI elements adapt to maintain readability and visual consistency

### Advanced Features

- **🎯 Preset Support**: Works with both custom prompts and official preset parameters
- **🔄 Real-time Injection**: Modify parameters without regenerating from scratch
- **📊 Structure Analysis**: Understand how Grok processes your prompts internally
- **🎨 Meta Prompting**: Use discovered structures as templates for new creations

## 🎬 Video Metadata Processing

For users who download multiple videos, we provide a Python tool for batch processing:

### What it does
- **Metadata Embedding**: Embeds JSON metadata into MP4 files using FFmpeg
- **Smart Renaming**: Automatically organizes files by prompt groups and versions
- **Batch Processing**: Process entire directories of downloaded videos at once

### Quick Setup
1. **Prerequisites**: Python 3.10+, FFmpeg
2. **Installation**:
   ```bash
   cd grok_video_processor
   pip install -r requirements.txt
   ```
3. **Usage**:
   ```bash
   python meta_video.py
   ```

### File Organization
The tool automatically organizes your downloaded videos:
- Groups videos by similar prompts
- Assigns priority numbers (P1, P2, etc.)
- Adds version numbers within groups (v1, v2, etc.)
- Final format: `grok_video_[uuid]_P1_v1.mp4`

**📖 Detailed documentation**: See [`grok_video_processor/README.md`](grok_video_processor/README.md) for complete setup and usage instructions.

## 🤝 Contributing

Welcome to contribute code! Please follow these steps:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Thanks to the following open source projects and developers for inspiration and help:

- [Grok](https://grok.com/) - Provides a powerful AI image generation platform
- Chrome Extension Development Community - Provides rich resources and guidance for extension development
- @nmsbnmsb1 - Initial dark mode implementation ideas and contributions

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=OtokoNoIzumi/grok-spirit&type=Date)](https://star-history.com/#OtokoNoIzumi/grok-spirit&Date)
