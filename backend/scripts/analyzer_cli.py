#!/usr/bin/env python3
"""示例分析 CLI — 向 stdout 输出 PROGRESS 行供 Node 解析（Windows / Linux 通用）"""
import argparse
import json
import os
import sys
import tempfile
import time


def result_path(task_id: str) -> str:
    base = os.path.join(tempfile.gettempdir(), "dpl304")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, f"{task_id}_result.json")


def build_result(video_url: str) -> dict:
    return {
        "version": "1.2",
        "metadata": {"video_id": "demo_001", "duration_sec": 15},
        "source_video": {"url": video_url, "duration": 15},
        "generated_video": {"url": video_url, "duration": 15},
        "semantic_anchors": [
            {
                "anchor_id": "anchor_1",
                "start_sec": 0,
                "end_sec": 5,
                "logic_intent": {"marketing_role": "hook", "emotion_vibe": "urgent"},
                "match": {
                    "status": "matched",
                    "asset_name": "商品高管口播.mp4",
                },
                "replication_instructions": {
                    "visual_generation_prompt": "无需生成，使用原素材",
                    "overlay_rewrite_instruction": "限时秒杀，仅限今天",
                },
            },
            {
                "anchor_id": "anchor_2",
                "start_sec": 5,
                "end_sec": 15,
                "logic_intent": {
                    "marketing_role": "product_demo",
                    "emotion_vibe": "warm",
                },
                "match": {"status": "gap", "asset_name": None},
                "replication_instructions": {
                    "visual_generation_prompt": "一个白领在办公室优雅地喝咖啡的特写镜头",
                    "overlay_rewrite_instruction": "告别焦虑，享受生活",
                },
            },
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--task", required=True)
    args = parser.parse_args()

    stages = [
        (15, "解析样例", "读取视频流"),
        (40, "语义拆解", "提取 semantic_anchors"),
        (70, "素材匹配", "对齐用户素材库"),
        (100, "完成", "写入 structure_json"),
    ]

    for progress, stage, msg in stages:
        print(f"PROGRESS: {progress} | STAGE: {stage} | MSG: {msg}", flush=True)
        time.sleep(0.5)

    out_path = result_path(args.task)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(build_result(args.url), f, ensure_ascii=False)
    print(f"Wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
