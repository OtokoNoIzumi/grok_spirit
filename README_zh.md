<div align="center">

# 🎨 Grok Spirit

*Grok Imagen 参数编辑器 - Chrome扩展*

[English](README.md) | [中文](README_zh.md)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/logaoplejbodjhnogdndgllocmpmlako?label=Chrome%20商店版本&color=blue)](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako)
[![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/logaoplejbodjhnogdndgllocmpmlako?label=活跃用户&color=green)](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako)
[![GitHub stars](https://img.shields.io/github/stars/OtokoNoIzumi/grok_spirit?color=yellow&label=GitHub%20Stars)](https://github.com/OtokoNoIzumi/grok_spirit/stargazers)
[![GitHub license](https://img.shields.io/github/license/OtokoNoIzumi/grok_spirit?color=blue)](https://github.com/OtokoNoIzumi/grok_spirit/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/OtokoNoIzumi/grok_spirit)](https://github.com/OtokoNoIzumi/grok_spirit/commits)

**一个Chrome扩展，用于显示和编辑Grok Imagen提示参数**

![Grok Spirit 功能截图](https://otokonoizumi.github.io/media/grok%20spirit.png)

[🏪 Chrome商店安装](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako) · [📋 使用说明](#使用说明) · [🛠️ 本地安装](#本地安装) · [❓ 问题反馈](https://github.com/OtokoNoIzumi/grok_spirit/issues)

</div>

---

## ✨ 功能特点

- 🎯 **完整结构查看** - 显示完整的Grok Imagen提示结构
- ⚙️ **直接编辑** - 在界面中直接编辑参数
- 💾 **视频下载** - 下载带有匹配元数据的视频
- 🔧 **预设支持** - 支持自定义和预设提示
- 🌙 **暗色模式支持** - 自动同步Grok的主题（亮色/暗色）
- 🎬 **元数据处理** - 批量视频元数据嵌入的Python工具

## 🚀 快速开始

### Chrome商店安装（推荐）

点击下方按钮直接从Chrome商店安装：

[Chrome商店安装地址](https://chromewebstore.google.com/detail/logaoplejbodjhnogdndgllocmpmlako)

### 本地安装

1. **下载项目**
   ```bash
   git clone https://github.com/OtokoNoIzumi/grok_spirit.git
   # 或下载ZIP文件并解压
   ```

2. **加载扩展**
   - 打开Chrome浏览器，访问 `chrome://extensions/`
   - 开启右上角的"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目目录

3. **开始使用**
   - 访问 grok.com/imagine
   - 扩展将自动激活并显示参数编辑界面

## 📖 使用说明

### 基础操作

1. **🔍 参数发现**
   - 访问 grok.com/imagine 并生成视频
   - 扩展自动捕获并显示用于生成的完整提示结构
   - 查看详细参数，包括相机设置、光照、运动和场景构图

2. **✏️ 参数编辑**
   - 直接在界面中修改任何参数值
   - 尝试不同的相机角度、光照条件和运动设置
   - 更改可实时回填，便于即时测试

3. **💾 内容管理**
   - 下载带有匹配文件名的视频和meta信息文件
   - 保存和重用您喜欢的参数组合
   - 构建个人有效提示结构库

4. **🌙 主题支持**
   - 自动检测并同步Grok的当前主题
   - 在亮色和暗色模式下都有无缝体验
   - 所有UI元素都能适配以保持可读性和视觉一致性

### 高级功能

- **🎯 预设支持**: 支持自定义提示和官方预设参数
- **🔄 实时注入**: 无需从头重新生成即可修改参数
- **📊 结构分析**: 了解Grok如何在内部处理您的提示
- **🎨 元提示**: 使用发现的结构作为新创作的模板

## 🎬 视频元数据处理

我做了一个Python工具进行后期meta文件和视频的批量处理：

### 功能说明
- **元数据嵌入**: 使用FFmpeg将JSON元数据嵌入到MP4文件中
- **智能重命名**: 按提示组和版本自动组织文件
- **批量处理**: 一次性处理整个目录的下载视频

### 快速设置
1. **前置要求**: Python 3.10+, FFmpeg
2. **安装**:
   ```bash
   cd grok_video_processor
   pip install -r requirements.txt
   ```
3. **使用**:
   ```bash
   python meta_video.py
   ```

### 文件组织
工具会自动组织您的下载视频：
- 按相似提示分组视频
- 分配优先级编号（P1, P2等）
- 在组内添加版本号（v1, v2等）
- 最终格式：`grok_video_[uuid]_P1_v1.mp4`

**📖 详细文档**: 查看 [`grok_video_processor/README_zh.md`](grok_video_processor/README_zh.md) 获取完整的设置和使用说明。

## 🤝 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT License 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

感谢以下开源项目和开发者的启发与帮助：

- [Grok](https://grok.com/) - 提供了强大的AI图像生成平台
- Chrome扩展开发社区 - 为扩展开发提供了丰富的资源和指导
- @nmsbnmsb1 - 暗色模式实现的初始想法和贡献

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=OtokoNoIzumi/grok-spirit&type=Date)](https://star-history.com/#OtokoNoIzumi/grok-spirit&Date)