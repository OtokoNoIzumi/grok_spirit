# Grok Video Metadata Processor

一个用于批处理Grok视频元数据的Python脚本，支持将JSON元数据嵌入到MP4视频文件中，并按照指定规则重命名文件。

## 快速开始（新手用户）

### 前置要求
- Windows 10/11 系统
- 基本的计算机操作能力

### 安装步骤（预计耗时：15-30分钟）

1. **安装Python**（5-10分钟）
   - 访问 https://www.python.org/downloads/
   - 下载最新版本的Python（推荐3.10+）
   - 安装时**务必勾选**"Add Python to PATH"
   - 验证安装：打开命令提示符，输入 `python --version`

2. **安装FFmpeg**（5-10分钟）
   - 访问 https://ffmpeg.org/download.html
   - 下载Windows版本，解压到任意目录（如 `C:\ffmpeg`）
   - 将 `ffmpeg.exe` 所在目录添加到系统PATH环境变量
   - 验证安装：打开命令提示符，输入 `ffmpeg -version`

3. **下载并配置工具**（5-10分钟）
   - 下载本工具的所有文件到同一目录
   - 复制 `config.toml` 并根据需要修改路径设置
   - 安装依赖：打开命令提示符，在工具目录下运行 `pip install -r requirements.txt`

### 重要提示

**如果你是Python新手，强烈建议：**
- 🔍 **搜索视频教程**：在B站、YouTube等平台搜索"Python安装教程"、"FFmpeg安装教程"
- 🤖 **询问AI助手**：使用ChatGPT、Claude等AI工具获取详细的安装指导
- 📚 **参考官方文档**：Python和FFmpeg都有详细的官方安装文档

**常见问题：**
- PATH环境变量设置失败 → 搜索"Windows PATH环境变量设置教程"
- pip命令不识别 → 搜索"Python pip安装教程"
- FFmpeg找不到 → 搜索"FFmpeg Windows安装配置"

### 使用方法

```bash
python meta_video.py
```

**注意**：目录中的 `meta_video.bat` 文件，这是作者的个人环境启动脚本，依赖特定的Anaconda环境配置。你也可以通过Anaconda安装和管理python环境并做相应修改，或询问AI制作一个自己的个性化启动脚本。

## 功能特性

- **元数据嵌入**：使用FFmpeg将JSON元数据写入MP4文件的comment、title、genre字段
- **扩展属性**：使用Windows COM写入Media.Writer等扩展属性
- **智能重命名**：根据元数据内容自动生成规范的文件名
- **批处理支持**：一次性处理整个目录的视频文件
- **配置化**：支持配置文件自定义路径和参数

## 文件命名规则

输出文件名格式：`grok_video_[url_uuid]_P{n}_v{m}.mp4`

- **url_uuid**：从metadata.url的post后部分提取的UUID
- **P{n}**：按input_prompt分组后的优先级编号
- **v{m}**：同一组内按时间排序的版本号

### 分组逻辑

1. 如果`original_prompt`不是"Injection completely consistent"，使用`original_prompt`分组
2. 否则使用`structured_prompt`分组
3. 按分组数量从大到小排序确定P值
4. 同一组内按`download_time`从小到大排序确定v值

## 安装要求

### Python依赖

```bash
pip install -r requirements.txt
```

### FFmpeg

需要安装FFmpeg并确保可执行文件在系统PATH中，或通过配置文件指定路径。

**下载地址**：https://ffmpeg.org/download.html

**Windows安装步骤**：
1. 下载Windows版本
2. 解压到任意目录（如`C:\ffmpeg`）
3. 将`ffmpeg.exe`所在目录添加到系统PATH环境变量
4. 或在配置文件中指定完整路径

## 配置文件

复制`config.toml`并根据需要修改：

```toml
# Grok Video Metadata Processor 配置文件
ffmpeg_path = "E:\\Program Files\\ffmpeg.exe"
default_input_dir = "E:\\20250825_AICG\\sub"
default_output_dir = "E:\\20250825_AICG\\sub\\test"

writer_names = ["Izumi.Qu", "Grok"]

[file_naming]
prefix = "grok_video"
separator = "_"
uuid_max_length = 0

common_ffmpeg_paths = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg.exe",
    "C:\\Program Files (x86)\\ffmpeg.exe",
    "ffmpeg"
]
```

**注意**：脚本优先使用`config.toml`文件，如果不存在则回退到`config.json`格式。

### 配置说明

- `ffmpeg_path`：FFmpeg可执行文件路径
- `default_input_dir`：默认输入目录
- `default_output_dir`：默认输出目录
- `writer_names`：要写入Media.Writer的作者列表
- `file_naming.prefix`：文件名前缀
- `file_naming.separator`：分隔符
- `file_naming.uuid_max_length`：UUID最大长度限制（0表示不限制）

## 高级用法

### 指定路径

```bash
python meta_video.py "C:\ffmpeg\ffmpeg.exe" "D:\input" "D:\output"
```

参数顺序：FFmpeg路径、输入目录、输出目录。

### 配置文件

脚本会自动查找`config.json`文件，如果存在则使用其中的配置作为默认值。

## 输入文件要求

### 目录结构

```
input_directory/
├── video1.json
├── video1.mp4
├── video2.json
├── video2.mp4
└── ...
```

### JSON元数据格式

```json
{
  "original_prompt": "A beautiful sunset",
  "structured_prompt": {
    "style": "anime",
    "character": "girl"
  },
  "metadata": {
    "video_id": "1fee00a3-67fc-499c-ae84-20550090e980",
    "progress": 100,
    "download_time": "2025/10/20 07:23:07",
    "url": "https://grok.com/imagine/post/fa3f4731-15e3-4a53-ac93-2b2810a2c910",
    "video_url": "users/.../generated_video.mp4"
  }
}
```

## 输出说明

- **comment字段**：存储`structured_prompt`的JSON字符串
- **title字段**：存储`original_prompt`
- **genre字段**：存储`metadata.url`
- **Media.Writer**：写入配置的作者列表

## 错误处理

脚本会处理以下常见错误：

- FFmpeg路径不存在
- 输入/输出目录不存在或无权限
- JSON文件格式错误
- 对应的MP4文件不存在
- 元数据写入失败

## 注意事项

- 仅支持Windows系统（需要pywin32）
- 输出文件会覆盖已存在的同名文件
- 建议在处理前备份重要文件
- 确保有足够的磁盘空间存储输出文件

## 故障排除

### FFmpeg未找到

1. 检查FFmpeg是否正确安装
2. 确认FFmpeg在系统PATH中
3. 在配置文件中指定完整路径
4. 使用命令行参数指定路径

### 权限错误

1. 确保对输出目录有写入权限
2. 以管理员身份运行脚本
3. 检查文件是否被其他程序占用

### 元数据写入失败

1. 检查JSON文件格式是否正确
2. 确认对应的MP4文件存在
3. 检查文件是否损坏
