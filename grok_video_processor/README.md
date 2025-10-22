# Grok Video Metadata Processor

*Grok Video Metadata Processing Tool*

[English](README.md) | [中文](README_zh.md)

A Python script for batch processing Grok video metadata, supporting JSON metadata embedding into MP4 video files and renaming files according to specified rules.

## Quick Start (For Beginners)

### Prerequisites
- Windows 10/11 system
- Basic computer operation skills

### Installation Steps (Estimated time: 15-30 minutes)

1. **Install Python** (5-10 minutes)
   - Visit https://www.python.org/downloads/
   - Download the latest Python version (recommended 3.10+)
   - **Must check** "Add Python to PATH" during installation
   - Verify installation: Open command prompt, type `python --version`

2. **Install FFmpeg** (5-10 minutes)
   - Visit https://ffmpeg.org/download.html
   - Download Windows version, extract to any directory (e.g., `C:\ffmpeg`)
   - Add the directory containing `ffmpeg.exe` to system PATH environment variable
   - Verify installation: Open command prompt, type `ffmpeg -version`

3. **Download and Configure Tool** (5-10 minutes)
   - Download all tool files to the same directory
   - Copy `config.toml.example` to `config.toml` and modify path settings as needed
   - Install dependencies: Open command prompt, run `pip install -r requirements.txt` in the tool directory

### Important Tips

**If you're new to Python, we strongly recommend:**
- 🔍 **Search video tutorials**: Look for "Python installation tutorial", "FFmpeg installation tutorial" on Bilibili, YouTube, etc.
- 🤖 **Ask AI assistants**: Use ChatGPT, Claude and other AI tools for detailed installation guidance
- 📚 **Refer to official documentation**: Both Python and FFmpeg have detailed official installation documentation

**Common issues:**
- PATH environment variable setup failed → Search "Windows PATH environment variable setup tutorial"
- pip command not recognized → Search "Python pip installation tutorial"
- FFmpeg not found → Search "FFmpeg Windows installation configuration"

### Usage

```bash
python meta_video.py
```

### Language Note
⚠️ **Important**: This Python script (`meta_video.py`) uses Chinese prompts and messages. This is a personal tool primarily designed for Chinese users.

**Feel free to edit** the script to translate prompts to your preferred language, or create your own localized version. The core functionality is language-independent and will work regardless of the prompt language.

**Note**: The `meta_video.bat` file in the directory is the author's personal environment startup script, which depends on specific Anaconda environment configuration. You can also install and manage Python environments through Anaconda and make corresponding modifications, or ask AI to create your own personalized startup script.

## Features

- **Metadata Embedding**: Uses FFmpeg to write JSON metadata into MP4 file comment, title, genre fields
- **Extended Properties**: Uses Windows COM to write Media.Writer and other extended properties
- **Smart Renaming**: Automatically generates standardized filenames based on metadata content
- **Batch Processing**: Process entire directories of video files at once
- **Configurable**: Supports configuration file customization of paths and parameters

## File Naming Rules

Output filename format: `grok_video_[url_uuid]_P{n}_v{m}.mp4`

- **url_uuid**: UUID extracted from the post part of metadata.url
- **P{n}**: Priority number after grouping by input_prompt
- **v{m}**: Version number sorted by time within the same group

### Grouping Logic

1. If `original_prompt` is not "Injection completely consistent", use `original_prompt` for grouping
2. Otherwise use `structured_prompt` for grouping
3. Sort by group count from large to small to determine P value
4. Sort by `download_time` from small to large within the same group to determine v value

## Installation Requirements

### Python Dependencies

```bash
pip install -r requirements.txt
```

### FFmpeg

FFmpeg needs to be installed and the executable file should be in the system PATH, or specify the path through configuration file.

**Download address**: https://ffmpeg.org/download.html

**Windows installation steps**:
1. Download Windows version
2. Extract to any directory (e.g., `C:\ffmpeg`)
3. Add the directory containing `ffmpeg.exe` to system PATH environment variable
4. Or specify the full path in the configuration file

## Configuration File

### Initial Setup

1. Copy `config.toml.example` to `config.toml`
2. Modify the configuration as needed

```toml
# Grok Video Metadata Processor Configuration File
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

### Default Behavior

- If `config.toml` doesn't exist, the script will use default values:
  - **Input directory**: Current script directory
  - **Output directory**: `output` subdirectory in current script directory
  - **FFmpeg path**: Will attempt to auto-detect from common locations

**Note**: The script prioritizes using the `config.toml` file, and falls back to `config.json` format if it doesn't exist.

### Configuration Description

- `ffmpeg_path`: FFmpeg executable file path
- `default_input_dir`: Default input directory
- `default_output_dir`: Default output directory
- `writer_names`: List of authors to write to Media.Writer
- `file_naming.prefix`: Filename prefix
- `file_naming.separator`: Separator
- `file_naming.uuid_max_length`: UUID maximum length limit (0 means no limit)

## Advanced Usage

### Specify Paths

```bash
python meta_video.py "C:\ffmpeg\ffmpeg.exe" "D:\input" "D:\output"
```

Parameter order: FFmpeg path, input directory, output directory.

### Configuration File

The script automatically looks for the `config.toml` file first, then falls back to `config.json` if it doesn't exist. If neither exists, it uses default values based on the current script directory.

## Input File Requirements

### Directory Structure

```
input_directory/
├── video1.json
├── video1.mp4
├── video2.json
├── video2.mp4
└── ...
```

### JSON Metadata Format

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

## Output Description

- **comment field**: Stores JSON string of `structured_prompt`
- **title field**: Stores `original_prompt`
- **genre field**: Stores `metadata.url`
- **Media.Writer**: Writes configured author list

## Error Handling

The script handles the following common errors:

- FFmpeg path does not exist
- Input/output directory does not exist or no permission
- JSON file format error
- Corresponding MP4 file does not exist
- Metadata writing failure

## Notes

- Only supports Windows system (requires pywin32)
- Output files will overwrite existing files with the same name
- Recommend backing up important files before processing
- Ensure sufficient disk space to store output files

## Troubleshooting

### FFmpeg Not Found

1. Check if FFmpeg is correctly installed
2. Confirm FFmpeg is in system PATH
3. Specify full path in configuration file
4. Use command line parameters to specify path

### Permission Errors

1. Ensure write permission to output directory
2. Run script as administrator
3. Check if files are occupied by other programs

### Metadata Writing Failure

1. Check if JSON file format is correct
2. Confirm corresponding MP4 file exists
3. Check if files are corrupted
