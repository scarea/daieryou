#!/usr/bin/env python3
"""
Small desktop GUI for Ethiopian Cargo AWB tracking.
"""

from __future__ import annotations

import queue
import random
import threading
import time
from datetime import datetime
from pathlib import Path
from tkinter import BOTH, DISABLED, END, LEFT, NORMAL, RIGHT, X, Button, Frame, Label, StringVar, Tk, filedialog, messagebox, scrolledtext

import requests

from tracker import (
    DEFAULT_MAX_DELAY_SECONDS,
    DEFAULT_MIN_DELAY_SECONDS,
    DEFAULT_RETRIES,
    TRACKING_URL,
    TrackResult,
    query_one_awb,
    read_awbs,
    write_results,
)


class TrackerApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("Ethiopian Cargo 批量查询工具")
        self.root.geometry("760x520")
        self.root.minsize(680, 460)

        self.input_path = StringVar(value="未选择")
        self.output_path = StringVar(value="未选择")
        self.log_queue: queue.Queue[str] = queue.Queue()
        self.worker: threading.Thread | None = None
        self.running = False

        self._build_ui()
        self.root.after(100, self._drain_log_queue)

    def _build_ui(self) -> None:
        top = Frame(self.root, padx=16, pady=14)
        top.pack(fill=X)

        input_row = Frame(top)
        input_row.pack(fill=X, pady=6)
        Label(input_row, text="输入 Excel：", width=12, anchor="w").pack(side=LEFT)
        Label(input_row, textvariable=self.input_path, anchor="w").pack(side=LEFT, fill=X, expand=True)
        Button(input_row, text="选择文件", command=self.choose_input).pack(side=RIGHT)

        output_row = Frame(top)
        output_row.pack(fill=X, pady=6)
        Label(output_row, text="输出 Excel：", width=12, anchor="w").pack(side=LEFT)
        Label(output_row, textvariable=self.output_path, anchor="w").pack(side=LEFT, fill=X, expand=True)
        Button(output_row, text="选择保存位置", command=self.choose_output).pack(side=RIGHT)

        action_row = Frame(top)
        action_row.pack(fill=X, pady=10)
        self.start_button = Button(action_row, text="开始查询", command=self.start)
        self.start_button.pack(side=RIGHT)

        self.log = scrolledtext.ScrolledText(self.root, height=22, state=DISABLED)
        self.log.pack(fill=BOTH, expand=True, padx=16, pady=(0, 16))

    def choose_input(self) -> None:
        path = filedialog.askopenfilename(
            title="选择输入 Excel",
            filetypes=[("Excel 文件", "*.xlsx"), ("所有文件", "*.*")],
        )
        if path:
            self.input_path.set(path)
            if self.output_path.get() == "未选择":
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output = Path(path).with_name(f"ethiopian_cargo_result_{timestamp}.xlsx")
                self.output_path.set(str(output))

    def choose_output(self) -> None:
        path = filedialog.asksaveasfilename(
            title="选择输出位置",
            defaultextension=".xlsx",
            filetypes=[("Excel 文件", "*.xlsx")],
        )
        if path:
            self.output_path.set(path)

    def start(self) -> None:
        input_path = Path(self.input_path.get())
        output_path = Path(self.output_path.get())

        if self.running:
            return
        if not input_path.exists():
            messagebox.showerror("错误", "请先选择输入 Excel 文件。")
            return
        if self.output_path.get() == "未选择":
            messagebox.showerror("错误", "请先选择输出 Excel 文件位置。")
            return

        self.running = True
        self.start_button.configure(state=DISABLED)
        self.worker = threading.Thread(target=self._run, args=(input_path, output_path), daemon=True)
        self.worker.start()

    def _run(self, input_path: Path, output_path: Path) -> None:
        results: list[TrackResult] = []
        try:
            awbs = read_awbs(input_path)
            if not awbs:
                self._log("输入 Excel 中没有找到 AWB。请确认第一列从第二行开始填写。")
                return

            self._log(f"读取到 {len(awbs)} 个不重复 AWB。")

            session = requests.Session()
            session.headers.update(
                {
                    "User-Agent": "CargoTrackingBackOfficeTool/1.0",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                }
            )

            for index, awb in enumerate(awbs, start=1):
                self._log(f"[{index}/{len(awbs)}] 查询 {awb} ...")
                result = query_one_awb(
                    session,
                    awb,
                    DEFAULT_RETRIES,
                    DEFAULT_MIN_DELAY_SECONDS,
                    DEFAULT_MAX_DELAY_SECONDS,
                )
                results.append(result)
                write_results(output_path, results)
                self._log(f"[{awb}] {result.status}，航班 {len(result.flights)} 条，轨迹 {len(result.histories)} 条。")

                if index < len(awbs):
                    delay = random.uniform(DEFAULT_MIN_DELAY_SECONDS, DEFAULT_MAX_DELAY_SECONDS)
                    self._log(f"等待 {round(delay, 1)} 秒后继续下一票。")
                    time.sleep(delay)

            self._log(f"完成，结果文件：{output_path}")
            self.log_queue.put("__DONE__")
        except Exception as exc:
            if results:
                write_results(output_path, results)
                self._log(f"已保存当前进度：{output_path}")
            self._log(f"任务停止：{exc}")
            self.log_queue.put("__FAILED__")

    def _log(self, message: str) -> None:
        self.log_queue.put(message)

    def _drain_log_queue(self) -> None:
        try:
            while True:
                message = self.log_queue.get_nowait()
                if message in {"__DONE__", "__FAILED__"}:
                    self.running = False
                    self.start_button.configure(state=NORMAL)
                    if message == "__DONE__":
                        messagebox.showinfo("完成", "查询完成，结果 Excel 已生成。")
                    continue

                self.log.configure(state=NORMAL)
                self.log.insert(END, message + "\n")
                self.log.see(END)
                self.log.configure(state=DISABLED)
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log_queue)


def main() -> None:
    root = Tk()
    TrackerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
