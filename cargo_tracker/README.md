# Ethiopian Cargo 批量查询工具

这个目录是一版可验证的小工具：从 Excel 读取提单号，逐个查询 Ethiopian Cargo 页面，再把航班计划和货物轨迹写入结果 Excel。

## 你在 Mac 上如何验证

进入工具目录：

```bash
cd /Users/awen/code/daieryou/cargo_tracker
```

创建虚拟环境并安装依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

生成输入模板：

```bash
python tracker.py --create-template input_template.xlsx
```

快速测试一票：

```bash
python tracker.py --input input_template.xlsx --output output/test_result.xlsx --fast-test
```

正常批量运行：

```bash
python tracker.py --input input_template.xlsx --output output/result.xlsx
```

正常模式会在每票之间随机等待 6-18 秒；失败会最多尝试 3 次。`--fast-test` 只用于你自己验证，不建议给客服使用。

## 输入 Excel 格式

第一行必须是表头，第一列从第二行开始放 AWB：

| AWB |
| --- |
| 071-61046882 |
| 071-xxxxxxxx |

工具会自动去重，避免同一批里重复查询同一个 AWB。

## 输出 Excel

输出文件包含 3 个 sheet：

- `查询汇总`：每个 AWB 的查询状态、航班数量、轨迹数量、错误信息。
- `航班计划`：航段、航班号、日期、货运状态。
- `货物轨迹`：事件、详情、时间。

## 温和访问策略

- 每票查询后随机等待。
- 单票失败最多重试 3 次。
- 重试等待时间递增，并带随机抖动。
- 每查完一票就保存当前结果，任务中断也能拿到已完成部分。
- 遇到 HTTP 403、HTTP 429、验证码、访问拒绝等信号会停止任务。

这个工具不做验证码绕过、代理池、隐藏身份等规避行为。

## GUI 版本怎么在 Mac 上调试

```bash
cd /Users/awen/code/daieryou/cargo_tracker
source .venv/bin/activate
python tracker_gui.py
```

打开窗口后选择输入 Excel 和输出 Excel，然后点击“开始查询”。

## Windows 版本怎么给客服

代码验证稳定后，在 Windows 电脑上执行：

```powershell
cd cargo_tracker
build_windows.bat
```

生成的文件在：

```text
dist\EthiopianCargoTracker.exe
```

客服使用时只需要双击 `EthiopianCargoTracker.exe`，选择输入 Excel，再选择结果保存位置。

注意：Windows `.exe` 建议在 Windows 电脑上打包。Mac 上打包出的文件只能给 Mac 使用。
