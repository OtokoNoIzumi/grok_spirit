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
import hashlib
from datetime import datetime
from collections import defaultdict
from win32com.propsys import propsys
from win32com.shell import shellcon

try:
    import toml
    TOML_AVAILABLE = True
except ImportError:
    TOML_AVAILABLE = False

# region 辅助功能
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


def apply_filename_prefix_replacement(filename, config):
    """
    根据配置替换文件名前缀
    如果配置启用且文件名以 grok_video_ 开头，则替换为 grok-video-
    """
    replace_prefix = config.get('file_naming', {}).get('replace_grok_video_prefix', True)

    if replace_prefix and filename.startswith('grok_video_'):
        return filename.replace('grok_video_', 'grok-video-', 1)

    return filename


def load_video_prompt_templates(config_file='video_prompt_templates.json'):
    """加载视频提示词模板配置文件"""
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"警告: 读取视频提示词模板配置文件失败: {e}")
            return {}
    return {}


def save_video_prompt_templates(config, config_file='video_prompt_templates.json'):
    """保存视频提示词模板配置文件"""
    try:
        # 对每个分类的模板按key排序
        sorted_config = config.copy()
        for category_key, category in sorted_config['categories'].items():
            if 'templates' in category:
                # 按key排序模板
                sorted_templates = dict(sorted(category['templates'].items()))
                category['templates'] = sorted_templates

        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(sorted_config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"保存视频提示词模板配置文件失败: {e}")


def migrate_existing_categories(templates_config):
    """
    迁移现有分类数据到新的分类结构
    """

    # 定义旧分类到新分类的映射
    old_to_new_mapping = {
        "non_injection_non_dict": "regular_prompt",
        "non_injection_dict": "parameter_control",
        "injection_consistent": "strict_injection"
    }

    # 检查是否已经使用新分类结构
    current_categories = templates_config.get('categories', {})
    has_new_structure = any(key in current_categories for key in ["regular_prompt", "parameter_control", "strict_injection"])
    has_old_structure = any(key in current_categories for key in ["non_injection_non_dict", "non_injection_dict", "injection_consistent"])

    if has_new_structure and not has_old_structure:
        return

    print("开始迁移现有分类数据...")

    # 新的分类结构
    new_categories = {
        "regular_prompt": {
            "name": "常规提示词",
            "description": "非injection完全一致，非字典类型，长度在500以内",
            "priority": 1,
            "templates": {}
        },
        "parameter_control": {
            "name": "参数控制提示词",
            "description": "非injection完全一致，字典型，或者长度在500及以上",
            "priority": 2,
            "templates": {}
        },
        "strict_injection": {
            "name": "严格注入提示词",
            "description": "Injection完全一致",
            "priority": 3,
            "templates": {}
        }
    }

    # 如果已经有新结构，保留现有数据
    if has_new_structure:
        for key in ["regular_prompt", "parameter_control", "strict_injection"]:
            if key in current_categories and 'templates' in current_categories[key]:
                new_categories[key]["templates"] = current_categories[key]["templates"]

    # 迁移现有模板数据
    migrated_count = 0
    for old_key, new_key in old_to_new_mapping.items():
        if old_key in templates_config['categories']:
            old_category = templates_config['categories'][old_key]
            if 'templates' in old_category:
                # 对于 non_injection_non_dict，需要重新分类
                if old_key == "non_injection_non_dict":
                    for template_key, template_data in old_category['templates'].items():
                        prompt_content = template_data.get('prompt_content', '')
                        prompt_length = len(prompt_content)

                        # 根据新规则重新分类
                        if prompt_length >= 500:
                            new_categories["parameter_control"]["templates"][template_key] = template_data
                        else:
                            new_categories["regular_prompt"]["templates"][template_key] = template_data
                        migrated_count += 1
                else:
                    # 直接迁移其他分类
                    new_categories[new_key]["templates"] = old_category['templates']
                    migrated_count += len(old_category['templates'])

    # 更新分类结构
    templates_config['categories'] = new_categories

    print(f"迁移完成，共迁移 {migrated_count} 个模板")

# endregion

# region 提示词模块

def categorize_prompt(meta_obj):
    """
    根据meta_obj的original_prompt对提示词进行分类

    返回: (category_key, prompt_content, prompt_key)
    """
    original_prompt = meta_obj.get('original_prompt', '')
    structured_prompt = meta_obj.get('structured_prompt', {})

    # 判断是否为Injection完全一致
    if original_prompt == "Injection completely consistent":
        category_key = "strict_injection"
        # 对于Injection完全一致的情况，使用structured_prompt作为内容
        if isinstance(structured_prompt, dict):
            prompt_content = json.dumps(structured_prompt, ensure_ascii=False, separators=(',', ':'))
        else:
            prompt_content = str(structured_prompt)
    else:
        # 非Injection完全一致的情况，使用original_prompt作为内容
        prompt_content = str(original_prompt)
        prompt_length = len(prompt_content)

        # 判断original_prompt是否为字典或长度>=500
        if isinstance(original_prompt, dict) or prompt_length >= 500:
            category_key = "parameter_control"
        else:
            category_key = "regular_prompt"

    # 生成提示词key：original_prompt前5-10个字符 + 哈希值
    prompt_key = generate_prompt_key(original_prompt, prompt_content)

    return category_key, prompt_content, prompt_key


def generate_prompt_key(original_prompt, prompt_content):
    """
    生成提示词key：original_prompt前5-10个合法字符 + 内容哈希值

    返回: 组合的key字符串
    """
    # 提取original_prompt的前5-10个合法字符
    prompt_str = str(original_prompt)
    prefix_chars = []

    for char in prompt_str:
        if char.isalnum() or char in '_-':
            prefix_chars.append(char)
            if len(prefix_chars) >= 10:
                break

    # 如果合法字符不足5个，用哈希值填充
    if len(prefix_chars) < 5:
        content_hash = hashlib.md5(prompt_content.encode('utf-8')).hexdigest()[:8]
        prefix_chars.extend(list(content_hash[:5-len(prefix_chars)]))

    # 取前5-10个字符作为前缀
    prefix = ''.join(prefix_chars[:10])

    # 生成内容哈希值
    content_hash = hashlib.md5(prompt_content.encode('utf-8')).hexdigest()[:8]

    # 组合前缀和哈希值
    return f"{prefix}_{content_hash}"


def update_video_prompt_templates(meta_files_info, config_file='video_prompt_templates.json'):
    """
    更新视频提示词模板配置

    Args:
        meta_files_info: 元数据文件信息字典
        config_file: 配置文件路径
    """
    print("\n=== 开始更新视频提示词模板配置 ===")

    # 加载现有配置
    templates_config = load_video_prompt_templates(config_file)

    # 初始化配置结构
    if 'categories' not in templates_config:
        templates_config['categories'] = {
            "regular_prompt": {
                "name": "常规提示词",
                "description": "非injection完全一致，非字典类型，长度在500以内",
                "priority": 1,
                "templates": {}
            },
            "parameter_control": {
                "name": "参数控制提示词",
                "description": "非injection完全一致，字典型，或者长度在500及以上",
                "priority": 2,
                "templates": {}
            },
            "strict_injection": {
                "name": "严格注入提示词",
                "description": "Injection完全一致",
                "priority": 3,
                "templates": {}
            }
        }
    else:
        # 迁移现有数据到新的分类结构
        migrate_existing_categories(templates_config)

    if 'statistics' not in templates_config:
        templates_config['statistics'] = {
            "total_videos": 0,
            "total_urls": 0,
            "last_updated": ""
        }

    # 统计信息
    total_videos = 0
    total_urls = set()

    # 处理每个元数据文件
    for base_name, meta_info in meta_files_info.items():
        meta_obj = meta_info['meta_obj']

        # 分类提示词
        category_key, prompt_content, prompt_hash = categorize_prompt(meta_obj)

        # 获取URL
        url = meta_obj.get('metadata', {}).get('url', '')
        if url:
            total_urls.add(url)

        total_videos += 1

        # 更新模板配置
        category = templates_config['categories'][category_key]

        if prompt_hash not in category['templates']:
            # 创建新模板
            category['templates'][prompt_hash] = {
                "prompt_content": prompt_content,
                "video_count": 0,
                "urls": set(),
                "first_seen": datetime.now().isoformat(),
                "last_seen": datetime.now().isoformat()
            }

        # 更新模板统计
        template = category['templates'][prompt_hash]
        template['video_count'] += 1
        if url:
            # 确保urls是set类型
            if isinstance(template['urls'], list):
                template['urls'] = set(template['urls'])
            template['urls'].add(url)
        template['last_seen'] = datetime.now().isoformat()

    # 转换set为list以便JSON序列化
    for category in templates_config['categories'].values():
        for template in category['templates'].values():
            template['urls'] = list(template['urls'])

    # 更新统计信息
    templates_config['statistics']['total_videos'] = total_videos
    templates_config['statistics']['total_urls'] = len(total_urls)
    templates_config['statistics']['last_updated'] = datetime.now().isoformat()

    # 保存配置
    save_video_prompt_templates(templates_config, config_file)

    # 输出统计信息
    print(f"视频提示词模板配置更新完成:")
    print(f"  总视频数: {total_videos}")
    print(f"  总URL数: {len(total_urls)}")

    for category_key, category in templates_config['categories'].items():
        template_count = len(category['templates'])
        total_template_videos = sum(t['video_count'] for t in category['templates'].values())
        print(f"  {category['name']}: {template_count} 个模板, {total_template_videos} 个视频")

    print(f"配置文件已保存: {config_file}")


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

# endregion

# region 主处理函数

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

    # 查找所有元数据文件和视频文件
    meta_files = [f for f in os.listdir(INPUT_DIR) if f.endswith(META_EXTENSION)]
    video_files = [f for f in os.listdir(INPUT_DIR) if f.endswith(VIDEO_EXTENSION)]

    print(f"目录统计:")
    print(f"  - JSON文件: {len(meta_files)} 个")
    print(f"  - MP4文件: {len(video_files)} 个")
    print(f"\n开始处理...")

    def find_matching_video(meta_obj, meta_base_name, video_files, input_dir):
        """
        智能匹配视频文件，按优先级进行3轮查找：
        1. 使用JSON内部的video_id匹配
        2. 同名匹配
        3. 将grok_video_替换成grok-video-再匹配
        """
        video_extension = '.mp4'

        # 第一轮：使用video_id匹配
        if 'metadata' in meta_obj and 'video_id' in meta_obj['metadata']:
            video_id = meta_obj['metadata']['video_id']
            for video_filename in video_files:
                video_base_name = os.path.splitext(video_filename)[0]
                if video_base_name == video_id:
                    video_path = os.path.join(input_dir, video_filename)
                    if os.path.exists(video_path):
                        return video_path, f"video_id匹配: {video_id}"

        # 第二轮：同名匹配
        expected_video_filename = meta_base_name + video_extension
        expected_video_path = os.path.join(input_dir, expected_video_filename)
        if os.path.exists(expected_video_path):
            return expected_video_path, f"同名匹配: {expected_video_filename}"

        # 第三轮：grok_video_替换匹配
        if 'grok_video_' in meta_base_name:
            modified_base_name = meta_base_name.replace('grok_video_', 'grok-video-')
            modified_video_filename = modified_base_name + video_extension
            modified_video_path = os.path.join(input_dir, modified_video_filename)
            if os.path.exists(modified_video_path):
                return modified_video_path, f"替换匹配: {modified_video_filename}"

        return None, "未找到匹配的视频文件"

    # 第一步：读取所有元数据文件并检查对应的视频文件
    meta_files_info = {}
    failed_reads = []
    missing_videos = []
    missing_json_videos = []

    # 创建所有MP4文件的基础名称集合
    all_video_base_names = set()
    for video_filename in video_files:
        base_name = os.path.splitext(video_filename)[0]
        all_video_base_names.add(base_name)

    for meta_filename in meta_files:
        base_name = os.path.splitext(meta_filename)[0]
        source_meta_path = os.path.join(INPUT_DIR, meta_filename)

        try:
            with open(source_meta_path, 'r', encoding='utf-8') as f:
                meta_obj = json.load(f)

                # 使用智能匹配函数查找对应的视频文件
                video_path, match_info = find_matching_video(meta_obj, base_name, video_files, INPUT_DIR)

                if video_path is None:
                    missing_videos.append(f"{base_name}: {match_info}")
                    continue

                meta_files_info[base_name] = {
                    'meta_obj': meta_obj,
                    'meta_path': source_meta_path,
                    'video_path': video_path,
                    'match_info': match_info
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

    if missing_json_videos:
        print(f"跳过: {len(missing_json_videos)} 个MP4文件缺少对应的JSON文件:")
        for missing in missing_json_videos:
            print(f"  - {missing}.mp4")

    # 计算真正缺少JSON的MP4文件（没有被任何JSON文件匹配的MP4文件）
    matched_video_base_names = set()
    for base_name, info in meta_files_info.items():
        # 从视频路径中提取基础名称
        video_path = info['video_path']
        video_filename = os.path.basename(video_path)
        video_base_name = os.path.splitext(video_filename)[0]
        matched_video_base_names.add(video_base_name)

    # 找出真正缺少JSON的MP4文件
    missing_json_base_names = all_video_base_names - matched_video_base_names
    for base_name in missing_json_base_names:
        missing_json_videos.append(base_name)

    # 显示匹配统计信息
    if meta_files_info:
        print(f"\n匹配统计:")
        match_types = {}
        for base_name, info in meta_files_info.items():
            match_info = info.get('match_info', '未知')
            match_type = match_info.split(':')[0] if ':' in match_info else match_info
            match_types[match_type] = match_types.get(match_type, 0) + 1

        for match_type, count in match_types.items():
            print(f"  - {match_type}: {count} 个文件")

    # 计算命名信息
    naming_info = calculate_file_naming_info(meta_files_info, config)
    print(f"命名信息计算完成，共 {len(naming_info)} 个文件可处理")

    # 更新视频提示词模板配置
    update_video_prompt_templates(meta_files_info)

    success_count = 0
    fail_count = 0
    raw_copy_count = 0
    miss_json_count = 0

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

        # 应用文件名前缀替换
        new_filename = apply_filename_prefix_replacement(new_filename, config)
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

    # 处理缺少JSON的MP4文件 - 复制到输出目录并添加raw_前缀
    if missing_json_videos:
        print(f"\n开始复制缺少JSON的MP4文件...")

    for base_name in missing_json_videos:
        filename = f"{base_name}.mp4"
        source_video_path = os.path.join(INPUT_DIR, filename)

        # 生成带_raw后缀的新文件名
        base_name_without_ext = os.path.splitext(filename)[0]
        raw_filename = f"{base_name_without_ext}_raw.mp4"

        # 应用文件名前缀替换
        raw_filename = apply_filename_prefix_replacement(raw_filename, config)
        output_video_path = os.path.join(OUTPUT_DIR, raw_filename)

        try:
            # 检查输出文件是否已存在，如果存在则删除
            if os.path.exists(output_video_path):
                os.remove(output_video_path)

            # 复制文件
            shutil.copy2(source_video_path, output_video_path)
            print(f"📋 {base_name} -> {raw_filename}")
            raw_copy_count += 1

        except Exception as e:
            print(f"❌ {base_name}: 复制失败 - {e}")
            fail_count += 1

    # 处理缺少视频文件的JSON文件 - 复制到输出目录并添加_miss后缀
    if missing_videos:
        print(f"\n开始处理缺少视频文件的JSON文件...")

    for missing_video_item in missing_videos:
        # 解析文件名 (格式: "filename: 找不到对应的视频文件")
        base_name = missing_video_item.split(':')[0]
        json_filename = f"{base_name}.json"
        source_json_path = os.path.join(INPUT_DIR, json_filename)

        try:
            # 读取JSON文件内容以提取UUID
            with open(source_json_path, 'r', encoding='utf-8') as f:
                meta_obj = json.load(f)

            # 尝试从metadata.url中提取UUID
            url = meta_obj.get('metadata', {}).get('url', '')
            uuid = extract_uuid_from_url(url, config.get('file_naming', {}).get('uuid_max_length', 0))

            # 生成带_miss后缀的新文件名
            if uuid:
                miss_filename = f"{base_name}_{uuid}_miss.json"
            else:
                miss_filename = f"{base_name}_miss.json"

            # 应用文件名前缀替换
            miss_filename = apply_filename_prefix_replacement(miss_filename, config)
            output_json_path = os.path.join(OUTPUT_DIR, miss_filename)

            # 检查输出文件是否已存在，如果存在则删除
            if os.path.exists(output_json_path):
                os.remove(output_json_path)

            # 复制文件
            shutil.copy2(source_json_path, output_json_path)
            print(f"📄 {base_name} -> {miss_filename}")
            miss_json_count += 1

        except Exception as e:
            print(f"❌ {base_name}: 处理JSON失败 - {e}")
            fail_count += 1

    # 计算跳过的文件数量（只包括读取失败的JSON文件）
    skipped_count = len(failed_reads)

    print(f"\n{'='*50}")
    print(f"处理完成:")
    print(f"  ✅ 成功处理: {success_count} 个 (带元数据的视频)")
    print(f"  📋 复制原始: {raw_copy_count} 个 (_raw后缀的视频)")
    print(f"  📄 处理JSON: {miss_json_count} 个 (_miss后缀的JSON)")
    print(f"  ❌ 失败: {fail_count} 个")
    print(f"  ⏭️ 跳过: {skipped_count} 个")
    if skipped_count:
        print(f"\n跳过详情:")
        print(f"  - JSON读取失败: {len(failed_reads)} 个")
    print(f"\n文件统计:")
    print(f"  - 输入MP4文件: {len(video_files)} 个")
    print(f"  - 输入JSON文件: {len(meta_files)} 个")
    print(f"  - 输出文件总数: {success_count + raw_copy_count + miss_json_count} 个")
    print(f"    * 视频文件: {success_count + raw_copy_count} 个")
    print(f"    * JSON文件: {miss_json_count} 个")
    if success_count > 0 or raw_copy_count > 0 or miss_json_count > 0:
        print(f"输出目录: {OUTPUT_DIR}")


if __name__ == "__main__":
    process_videos()

# endregion
