#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批处理脚本：将JSON元数据写入MP4视频文件
遍历输入目录，为每个JSON文件找到对应的MP4文件：
1) 用 ffmpeg 写入 comment(structured_prompt) 与 title(original_prompt)
2) 用 Windows COM 属性写入 AuthorUrl(metadata.url) 并将 "Izumi.Qu" 追加到 Media.Writer
"""

import os
import subprocess
import argparse
import json
import pythoncom
import re
import shutil
from datetime import datetime
from collections import defaultdict
from win32com.propsys import propsys
from win32com.shell import shellcon

try:
    import toml
    TOML_AVAILABLE = True
except ImportError:
    TOML_AVAILABLE = False


def load_config():
    """
    加载配置文件，支持TOML和JSON格式
    """
    # 优先尝试TOML格式
    toml_file = "config.toml"
    json_file = "config.json"

    if os.path.exists(toml_file):
        if not TOML_AVAILABLE:
            print("警告: 检测到TOML配置文件但未安装toml库，请运行: pip install toml")
            return {}
        try:
            with open(toml_file, 'r', encoding='utf-8') as f:
                return toml.load(f)
        except Exception as e:
            print(f"警告: 读取TOML配置文件失败: {e}")

    # 回退到JSON格式
    if os.path.exists(json_file):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"警告: 读取JSON配置文件失败: {e}")

    return {}


def find_ffmpeg(ffmpeg_path=None, common_paths=None):
    """
    智能查找FFmpeg路径
    """
    # 首先检查指定的路径
    if ffmpeg_path and os.path.exists(ffmpeg_path):
        return ffmpeg_path

    # 检查PATH中的ffmpeg
    if shutil.which("ffmpeg"):
        return "ffmpeg"

    # 检查常见路径
    if common_paths:
        for path in common_paths:
            if os.path.exists(path):
                return path
            if shutil.which(path):
                return path

    return None


def extract_uuid_from_url(url, max_length=0):
    """
    从URL中提取post后的UUID部分
    例如: https://grok.com/imagine/post/fa3f4731-15e3-4a53-ac93-2b2810a2c910
    返回: fa3f4731-15e3-4a53-ac93-2b2810a2c910
    """
    if not url:
        return ""

    # 使用正则表达式匹配post/后的UUID
    pattern = r'/post/([a-f0-9-]+)'
    match = re.search(pattern, url)
    if match:
        uuid = match.group(1)
        # 如果设置了长度限制，则截取
        if max_length > 0 and len(uuid) > max_length:
            uuid = uuid[:max_length]
        return uuid
    return ""


def parse_download_time(download_time_str):
    """
    解析download_time字符串为datetime对象
    格式: "2025/10/20 07:23:07"
    """
    try:
        return datetime.strptime(download_time_str, "%Y/%m/%d %H:%M:%S")
    except ValueError:
        # 如果解析失败，返回一个很早的时间
        return datetime.min


def get_input_prompt_for_grouping(meta_obj):
    """
    根据规则确定用于分组的input_prompt
    如果original_prompt不是"Injection completely consistent"，就用original_prompt
    否则用structured_prompt
    """
    original_prompt = meta_obj.get('original_prompt', '')

    if original_prompt != "Injection completely consistent":
        return str(original_prompt)  # 确保返回字符串
    else:
        structured_prompt = meta_obj.get('structured_prompt', {})
        # 将structured_prompt转换为字符串用于分组
        try:
            if isinstance(structured_prompt, dict):
                return json.dumps(structured_prompt, ensure_ascii=False, separators=(',', ':'))
            else:
                return str(structured_prompt)
        except Exception as e:
            print(f"警告: 处理structured_prompt时出错: {e}, 值: {structured_prompt}")
            return str(structured_prompt)


def calculate_file_naming_info(meta_files_info, config):
    """
    计算所有文件的命名信息
    返回: {filename: {'p': p_value, 'v': v_value, 'uuid': uuid}}
    """
    # 获取UUID长度限制
    uuid_max_length = config.get('file_naming', {}).get('uuid_max_length', 0)

    # 按URL分组（每个URL是一个独立的分组）
    url_groups = defaultdict(list)

    for filename, meta_info in meta_files_info.items():
        try:
            meta_obj = meta_info['meta_obj']
            url = meta_obj.get('metadata', {}).get('url', '')
            uuid = extract_uuid_from_url(url, uuid_max_length)

            # 使用UUID作为分组键，如果没有UUID则使用_blank_
            group_key = uuid if uuid else "_blank_"

            url_groups[group_key].append({
                'filename': filename,
                'meta_info': meta_info,
                'uuid': uuid,
                'download_time': parse_download_time(meta_obj.get('metadata', {}).get('download_time', '')),
                'input_prompt': get_input_prompt_for_grouping(meta_obj)
            })
        except Exception as e:
            print(f"错误: 处理文件 {filename} 时出错: {e}")
            print(f"  meta_obj: {meta_info.get('meta_obj', {})}")
            continue

    naming_info = {}

    # 对每个URL组独立处理
    for group_key, items in url_groups.items():
        # 在URL组内按input_prompt分组
        prompt_groups = defaultdict(list)

        for item in items:
            input_prompt = item['input_prompt']
            prompt_groups[input_prompt].append(item)

        # 按分组数量和最大download_time排序来确定P值（URL组内独立）
        sorted_prompt_groups = sorted(prompt_groups.items(),
                                     key=lambda x: (-len(x[1]), max(item['download_time'] for item in x[1])))

        # 在URL组内分配P值（从1开始）
        for p_value, (input_prompt, prompt_items) in enumerate(sorted_prompt_groups, 1):
            # 在同一个P组内，按download_time从小到大排序来确定v值
            sorted_items = sorted(prompt_items, key=lambda x: x['download_time'])

            for v_value, item in enumerate(sorted_items, 1):
                filename = item['filename']
                uuid = item['uuid']

                naming_info[filename] = {
                    'p': p_value,
                    'v': v_value,
                    'uuid': uuid
                }

    return naming_info


def process_videos():
    """
    主处理函数，遍历输入目录，为视频嵌入元数据。
    """
    print("--- 开始处理视频 ---")

    # 加载配置文件
    config = load_config()

    # 配置参数（可通过命令行覆盖）
    parser = argparse.ArgumentParser(description='批处理将JSON元数据写入MP4视频文件')
    parser.add_argument('ffmpeg_path', nargs='?',
                       default=config.get('ffmpeg_path', r'E:\Program Files\ffmpeg.exe'),
                       help='FFmpeg程序路径')
    parser.add_argument('input_dir', nargs='?',
                       default=config.get('default_input_dir', r'E:\20250825_AICG\sub'),
                       help='输入目录路径')
    parser.add_argument('output_dir', nargs='?',
                       default=config.get('default_output_dir', r'E:\20250825_AICG\sub\test'),
                       help='输出目录路径')

    args = parser.parse_args()

    # 智能查找FFmpeg路径
    FFMPEG_PATH = find_ffmpeg(args.ffmpeg_path, config.get('common_ffmpeg_paths', []))
    if not FFMPEG_PATH:
        print(f"错误: 找不到FFmpeg程序")
        print(f"请检查以下路径:")
        print(f"  指定路径: {args.ffmpeg_path}")
        print(f"  系统PATH: ffmpeg")
        if config.get('common_ffmpeg_paths'):
            print(f"  常见路径: {', '.join(config.get('common_ffmpeg_paths', []))}")
        print(f"请安装FFmpeg或将路径添加到配置文件config.json中")
        return

    print(f"使用FFmpeg路径: {FFMPEG_PATH}")

    INPUT_DIR = args.input_dir
    OUTPUT_DIR = args.output_dir
    META_EXTENSION = '.json'
    VIDEO_EXTENSION = '.mp4'

    # 确保输出目录存在
    if not os.path.exists(OUTPUT_DIR):
        print(f"创建输出目录: {OUTPUT_DIR}")
        os.makedirs(OUTPUT_DIR)

    # 查找所有元数据文件
    meta_files = [f for f in os.listdir(INPUT_DIR) if f.endswith(META_EXTENSION)]

    if not meta_files:
        print(f"错误：在目录 '{INPUT_DIR}' 中未找到任何 '{META_EXTENSION}' 文件。")
        return

    print(f"找到 {len(meta_files)} 个元数据文件，开始处理...")

    # 第一步：读取所有元数据文件并检查对应的视频文件
    meta_files_info = {}
    failed_reads = []
    missing_videos = []

    for meta_filename in meta_files:
        base_name = os.path.splitext(meta_filename)[0]
        source_meta_path = os.path.join(INPUT_DIR, meta_filename)
        source_video_path = os.path.join(INPUT_DIR, base_name + VIDEO_EXTENSION)

        try:
            with open(source_meta_path, 'r', encoding='utf-8') as f:
                meta_obj = json.load(f)

                # 检查对应的视频文件是否存在
                if not os.path.exists(source_video_path):
                    missing_videos.append(f"{base_name}: 找不到对应的视频文件")
                    continue

                meta_files_info[base_name] = {
                    'meta_obj': meta_obj,
                    'meta_path': source_meta_path,
                    'video_path': source_video_path
                }
        except Exception as e:
            failed_reads.append(f"{meta_filename}: {e}")
            continue

    if failed_reads:
        print(f"警告: {len(failed_reads)} 个元数据文件读取失败:")
        for failed in failed_reads:
            print(f"  - {failed}")

    if missing_videos:
        print(f"警告: {len(missing_videos)} 个元数据文件缺少对应的视频文件:")
        for missing in missing_videos:
            print(f"  - {missing}")

    # 计算命名信息
    naming_info = calculate_file_naming_info(meta_files_info, config)
    print(f"命名信息计算完成，共 {len(naming_info)} 个文件可处理")

    success_count = 0
    fail_count = 0

    # 只处理有命名信息的文件（即预处理阶段通过的文件）
    for base_name in naming_info.keys():
        meta_filename = base_name + META_EXTENSION
        video_filename = base_name + VIDEO_EXTENSION

        source_meta_path = os.path.join(INPUT_DIR, meta_filename)
        source_video_path = os.path.join(INPUT_DIR, video_filename)

        # 生成新的文件名
        naming_data = naming_info[base_name]
        uuid = naming_data['uuid']
        p_value = naming_data['p']
        v_value = naming_data['v']

        # 从配置文件获取命名设置
        file_naming_config = config.get('file_naming', {})
        prefix = file_naming_config.get('prefix', 'grok_video')
        separator = file_naming_config.get('separator', '_')

        # 构建文件名，处理UUID为空的情况
        if uuid:
            new_filename = f"{prefix}{separator}{uuid}{separator}P{p_value}{separator}v{v_value}{VIDEO_EXTENSION}"
        else:
            new_filename = f"{prefix}{separator}P{p_value}{separator}v{v_value}{VIDEO_EXTENSION}"

        output_video_path = os.path.join(OUTPUT_DIR, new_filename)

        # 1. 检查输出文件是否已存在，如果存在则删除
        if os.path.exists(output_video_path):
            try:
                os.remove(output_video_path)
            except Exception as e:
                print(f"❌ {base_name}: 无法删除已存在的文件 - {e}")
                fail_count += 1
                continue

        # 2. 视频文件检查已在预处理阶段完成，直接使用预处理的结果
        source_video_path = meta_files_info[base_name]['video_path']

        # 2. 使用已读取的元数据内容
        meta_obj = meta_files_info[base_name]['meta_obj']

        # comment：只存 structured_prompt
        structured_prompt = meta_obj.get('structured_prompt', {})
        metadata_content = json.dumps(structured_prompt, ensure_ascii=False, separators=(',', ':'))
        # keywords：存 metadata.url
        metadata_url = ''
        try:
            metadata_url = meta_obj.get('metadata', {}).get('url', '') or ''
        except Exception:
            metadata_url = ''
        # 副标题：放 original_prompt
        original_prompt = meta_obj.get('original_prompt', '') or ''

        # 3. 使用 ffmpeg 写入 comment、title 和 genre
        try:
            command = [
                FFMPEG_PATH,
                '-i', source_video_path,
                '-c', 'copy',
                '-map_metadata', '0',
                '-metadata', f'comment={metadata_content}',  # \u00a9cmt
                '-metadata', f'title={original_prompt}',     # \u00a9nam
                '-metadata', f'genre={metadata_url}',         # \u00a9gen
                '-y',
                output_video_path
            ]

            # 执行 ffmpeg 命令
            result = subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8')

            # 4. 使用 Windows COM 属性写入 Writer
            def write_extended_properties(dst_path, writer_to_add):
                try:
                    pythoncom.CoInitialize()
                    ps = propsys.SHGetPropertyStoreFromParsingName(
                        dst_path, None, shellcon.GPS_READWRITE, propsys.IID_IPropertyStore
                    )

                    # Writer (System.Media.Writer) - 写入多个作者（用分号分隔）
                    try:
                        if writer_to_add:
                            pkey_writer = propsys.PSGetPropertyKeyFromName('System.Media.Writer')
                            if isinstance(writer_to_add, list):
                                # 将多个作者用分号连接成一个字符串
                                writer_string = '; '.join(writer_to_add)
                                ps.SetValue(pkey_writer, propsys.PROPVARIANTType(writer_string))
                            else:
                                # 单个字符串
                                ps.SetValue(pkey_writer, propsys.PROPVARIANTType(writer_to_add))
                    except Exception as e:
                        print(f"  -> 警告: 写入 Writer 失败: {e}")

                    ps.Commit()
                finally:
                    try:
                        pythoncom.CoUninitialize()
                    except Exception:
                        pass

            # 从配置文件获取作者列表
            writer_names = config.get('writer_names', ['Izumi.Qu', 'Grok'])
            write_extended_properties(output_video_path, writer_names)

            print(f"✅ {base_name} -> {new_filename}")
            success_count += 1

        except subprocess.CalledProcessError as e:
            # 如果 FFmpeg 执行失败
            print(f"❌ {base_name}: FFmpeg 执行失败 - {e.stderr[:100]}...")
            fail_count += 1
        except FileNotFoundError:
            print(f"❌ {base_name}: 找不到 FFmpeg 程序")
            fail_count += 1

    # 计算跳过的文件数量
    skipped_count = len(failed_reads) + len(missing_videos)

    print(f"\n{'='*50}")
    print(f"处理完成: ✅ 成功 {success_count} 个, ❌ 失败 {fail_count} 个, ⏭️ 跳过 {skipped_count} 个")
    print(f"总计: {len(meta_files)} 个元数据文件")
    if success_count > 0:
        print(f"输出目录: {OUTPUT_DIR}")


if __name__ == "__main__":
    process_videos()