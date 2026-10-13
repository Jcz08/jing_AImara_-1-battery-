# -*- coding: utf-8 -*-
'''
make_docs.py — 生成两份正式 Word 文档：
1. 核心设计决策与技术取舍.docx
2. 团队的思考与判断.docx
数据取自 tools/bench-results.json（1000 条可复现基准）。
'''
import json
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, 'tools', 'bench-results.json'), encoding='utf-8') as f:
    B = json.load(f)


# ===================== 基础排版工具 =====================

def set_font(run, cn='宋体', en='Times New Roman', size=12, bold=False, color=None):
    run.font.name = en
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    rfonts.set(qn('w:eastAsia'), cn)
    rfonts.set(qn('w:ascii'), en)
    rfonts.set(qn('w:hAnsi'), en)


def init_document():
    doc = Document()
    # 页面：A4、上下左右 2.5 cm
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.5)
    sec.bottom_margin = Cm(2.5)
    sec.left_margin = Cm(2.5)
    sec.right_margin = Cm(2.5)

    # Normal：宋体 12pt、1.5 倍行距、首行缩进 2 字符
    normal = doc.styles['Normal']
    normal.font.name = 'Times New Roman'
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    pf = normal.paragraph_format
    pf.line_spacing = 1.5
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    ppr = normal.element.get_or_add_pPr()
    ind = ppr.find(qn('w:ind'))
    if ind is None:
        ind = OxmlElement('w:ind')
        ppr.append(ind)
    ind.set(qn('w:firstLineChars'), '200')
    ind.set(qn('w:firstLine'), '480')

    # 标题样式：黑体黑色
    specs = [('Title', 18, True), ('Heading 1', 16, True),
             ('Heading 2', 14, True), ('Heading 3', 12, True)]
    for name, size, bold in specs:
        st = doc.styles[name]
        st.font.name = 'Times New Roman'
        st.font.size = Pt(size)
        st.font.bold = bold
        st.font.color.rgb = RGBColor(0, 0, 0)
        st.element.rPr.rFonts.set(qn('w:eastAsia'), '黑体')
        st.paragraph_format.space_before = Pt(10 if name == 'Heading 1' else 8)
        st.paragraph_format.space_after = Pt(6)
        st.paragraph_format.line_spacing = 1.5
        st.paragraph_format.first_line_indent = Pt(0)
        # 清除首行缩进（标题不缩进）
        sppr = st.element.get_or_add_pPr()
        sind = sppr.find(qn('w:ind'))
        if sind is None:
            sind = OxmlElement('w:ind')
            sppr.append(sind)
        sind.set(qn('w:firstLineChars'), '0')
        sind.set(qn('w:firstLine'), '0')
    return doc


def add_title(doc, text, subtitle=None):
    p = doc.add_paragraph(style='Title')
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run(text), cn='黑体', size=18, bold=True)
    if subtitle:
        p2 = doc.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p2.paragraph_format.space_after = Pt(12)
        set_font(p2.add_run(subtitle), cn='楷体', size=12)
    p.paragraph_format.space_after = Pt(6)


def add_h(doc, level, text):
    p = doc.add_paragraph(style='Heading %d' % level)
    set_font(p.add_run(text), cn='黑体', size={1: 16, 2: 14, 3: 12}[level], bold=True)
    return p


def add_body(doc, text, indent=True):
    p = doc.add_paragraph()
    if not indent:
        ppr = p._element.get_or_add_pPr()
        ind = OxmlElement('w:ind')
        ind.set(qn('w:firstLineChars'), '0')
        ind.set(qn('w:firstLine'), '0')
        ppr.append(ind)
    set_font(p.add_run(text), cn='宋体', size=12)
    return p


def shade_cell(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    # OOXML 顺序：tcW → shd → vAlign，shd 必须插在 vAlign 之前
    valign = tcpr.find(qn('w:vAlign'))
    if valign is not None:
        valign.addprevious(shd)
    else:
        tcpr.append(shd)


def no_split(row):
    trpr = row._tr.get_or_add_trPr()
    if trpr.find(qn('w:cantSplit')) is None:
        cs = OxmlElement('w:cantSplit')
        # OOXML 顺序：cantSplit 在 tblHeader 之前
        th = trpr.find(qn('w:tblHeader'))
        if th is not None:
            th.addprevious(cs)
        else:
            trpr.append(cs)


def repeat_header(row):
    trpr = row._tr.get_or_add_trPr()
    if trpr.find(qn('w:tblHeader')) is None:
        th = OxmlElement('w:tblHeader')
        trpr.append(th)


def add_table(doc, headers, rows, widths=None, first_col_left=True):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    hdr = table.rows[0]
    repeat_header(hdr)
    no_split(hdr)
    for j, h in enumerate(headers):
        cell = hdr.cells[j]
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        shade_cell(cell, 'D9D9D9')
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.line_spacing = 1.0
        # 表格单元格：清首行缩进
        ppr = p._element.get_or_add_pPr()
        ind = OxmlElement('w:ind')
        ind.set(qn('w:firstLineChars'), '0')
        ind.set(qn('w:firstLine'), '0')
        ppr.append(ind)
        set_font(p.add_run(h), cn='宋体', size=10.5, bold=True)
    for r in rows:
        row = table.add_row()
        no_split(row)
        for j, v in enumerate(r):
            cell = row.cells[j]
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p = cell.paragraphs[0]
            p.paragraph_format.line_spacing = 1.0
            ppr = p._element.get_or_add_pPr()
            ind = OxmlElement('w:ind')
            ind.set(qn('w:firstLineChars'), '0')
            ind.set(qn('w:firstLine'), '0')
            ppr.append(ind)
            if j == 0:
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT if first_col_left else WD_ALIGN_PARAGRAPH.CENTER
            else:
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            set_font(p.add_run(str(v)), cn='宋体', size=10.5)
    if widths:
        for j, w in enumerate(widths):
            for row in table.rows:
                row.cells[j].width = Cm(w)
    return table


def add_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(8)
    ppr = p._element.get_or_add_pPr()
    ind = OxmlElement('w:ind')
    ind.set(qn('w:firstLineChars'), '0')
    ind.set(qn('w:firstLine'), '0')
    ppr.append(ind)
    set_font(p.add_run(text), cn='宋体', size=10.5)


# ===================== 文档一：核心设计决策与技术取舍 =====================

def doc_decisions():
    doc = init_document()
    add_title(doc, '1% Battery 核心设计决策与技术取舍',
              '北师港浸会 AI 赛道编程马拉松 · 工程与社会价值方向')

    add_h(doc, 1, '一、项目概述与设计目标')
    add_body(doc, '1% Battery 是一个纯静态、零依赖、可离线运行的交互式网页作品，'
             '以灾后或徒步求救为情境：手机仅剩 1% 电量，可用信道是一条受损窄带。'
             '作品的设计目标不是“把数据压到最小”，而是回答一个工程问题——'
             '在带宽、能量、算力、在线性同时受限的条件下，如何让一条信息真正送达并产生行动。')
    add_body(doc, '为此作品设定了两条主线：其一，所有算法从零实现且可编码、可解码、可自证正确；'
             '其二，所有对比数据在评委自己的设备上实时计算、固定种子可复现，并明确区分“实测”与“模型估算”。')

    add_h(doc, 1, '二、所选资源约束（口径声明）')
    add_body(doc, '作品显式声明并真实模拟以下资源约束，全部参数均可在界面中调整：')
    add_table(doc,
        ['约束类别', '取值范围（默认值）', '说明'],
        [
            ['极端窄带（主约束）', '100–2400 bps（600 bps）', '带宽'],
            ['', '丢包 0–50%（30%）', '单包丢失概率'],
            ['', 'RTT 100–2500 ms（1500 ms）', '停等往返时延'],
            ['', '包载荷 16–128 B（32 B）', '每包最大字节'],
            ['能量预算（主约束）', '5–410 J（30 J）', '1% 电量约 410 J'],
            ['旧设备算力（次约束）', '编解码耗时实测', '亚毫秒级'],
            ['离线可用（次约束）', '19 个文件 / 约 146 KB', 'Service Worker 预缓存'],
        ],
        widths=[4.2, 6.0, 5.8],
    )
    add_caption(doc, '表1 资源约束口径（与 README、应用界面一致）')
    add_body(doc, '能量模型基于常见锂电池规格：3.8 V 乘以 3000 mAh 约 41 kJ，1% 约 410 J；'
             '功耗系数取无线电 0.8 W、屏幕 0.4 W、CPU 0.3 W，属公开资料的数量级估计，'
             '界面中焦耳数值一律标注“模型估算”。')

    add_h(doc, 1, '三、六项核心设计决策')

    add_h(doc, 2, '决策一：分层协议优先于单包压缩')
    add_body(doc, '决策：把求救信息拆为 L0 信标、L1 定位、L2 详情三层，越靠前的层越短、越关键、独立可行动。'
             'L0 仅 5 字节，装下报文类型、数百米级粗坐标与严重度；L1 为 9 字节，携带时间戳与差分坐标；'
             'L2 为短语位与压缩文本。')
    add_body(doc, '放弃的替代方案：把所有字段紧凑打成一个二进制包（作品中也实现了该方案作对照）。'
             '单体位打包虽小，但接收端必须拿到整包才能解析，丢一个包即全盘作废；'
             '分层协议让接收端在 3.13 秒即可凭 L0 派出救援队，而不必等待 21 秒后的完整报文。')

    add_h(doc, 2, '决策二：位级打包，而不是字段名自描述')
    add_body(doc, '决策：采用 MSB-first 位写入器，字段按位分配，坐标用定点数与差分编码，'
             '整数用 LEB128 变长表示。JSON 基线平均 287.6 字节，三层合计平均 85.9 字节，压缩 3.35 倍；'
             '其中决定生死的 L0 仅 5 字节，相对 JSON 为 57.5 倍。')
    add_body(doc, '放弃的替代方案：继续使用 JSON 自描述文本。JSON 的字段名每次重发、中文按 UTF-8 占三字节，'
             '这些字节不带来任何信息增量；常规 App 习惯了“资源充足”，而本作品不为不增值的字节付费。')

    add_h(doc, 2, '决策三：静态预装 Huffman，并诚实对照动态模型')
    add_body(doc, '决策：L2 文本使用静态 Huffman 模型。模型由内置中英双语应急语料训练一次、规范化后作为'
             '418 字节常量随 App 预装，运行时零流量、零模型调用。')
    add_body(doc, '放弃的替代方案：动态 Huffman（表头随消息发送）与通用 gzip。作品完整实现了动态方案并如实展示：'
             '在徒步场景中动态表头约 68 字节，单条短报文摊不平该成本；gzip 经原生 CompressionStream 对照，'
             '平均 270.2 字节，短报文同样摊不平流头与字典，且仍是不可分割的整块。'
             '把这两个对照也做出来，是为了不回避“静态模型是否真的更好”的追问。')

    add_h(doc, 2, '决策四：共享应急短语词典')
    add_body(doc, '决策：预置 16 条双语应急短语（如“有人重伤，急需医疗救助”“请保持信号，不要关机”），'
             '勾选一条只占用 1 个标志位，双方依靠共享词典还原。')
    add_body(doc, '放弃的替代方案：把每句话逐字压缩传输。短句子在 Huffman 下仍要数十字节，'
             '而真正高频的应急表达数量有限，词典化是把“一次性成本”移出窄带的合理做法。')

    add_h(doc, 2, '决策五：零依赖纯静态 PWA')
    add_body(doc, '决策：原生 HTML、CSS 与 ES Module，零构建、零运行时框架、零第三方请求；'
             '柱状图、时间轴、Huffman 树均手写 SVG；Service Worker 预缓存全部 19 个文件，断网可用。')
    add_body(doc, '放弃的替代方案：React 或 Vue 全家桶、第三方图表库与 CDN。'
             '框架在资源充足时提供开发效率，但“为 1% 而建”的应用应当加载即安装、体积即信心；'
             '作品整包约 146 KB，也让评委可以读懂与验证每一个字节。')

    add_h(doc, 2, '决策六：确定性、可复现、口径透明')
    add_body(doc, '决策：所有随机过程使用固定种子（mulberry32，种子 20261013），'
             '蒙特卡洛与解析期望并列交叉验证，基准结果可导出 JSON。')
    add_body(doc, '放弃的替代方案：用无法复现的“演示数据”讲故事。'
             '作品把“实测”与“模型估算”分开标注，不做无法验证的承诺。')

    add_h(doc, 1, '四、技术取舍总览')
    add_table(doc,
        ['选择', '得到', '付出的代价'],
        [
            ['三层分级协议', 'L0 数秒内可行动、天然降级', '协议设计与合并逻辑更复杂'],
            ['位打包 + 定点差分', '体积约为 JSON 的 30%', '可读性下降，需位检视器辅助'],
            ['静态 Huffman 预装', '运行时零流量、短报文最优', '语料外文本只保证可解码'],
            ['短语共享词典', '高频表达每位一条', '依赖双方约定词典'],
            ['零依赖静态 PWA', '约 146 KB、可离线、可验证', '放弃框架的开发便利'],
            ['固定种子模拟', '结果可复现、可交叉验证', '不等同真实无线电测量'],
        ],
        widths=[4.5, 5.7, 5.8],
    )
    add_caption(doc, '表2 关键技术取舍一览')

    add_h(doc, 1, '五、对比数据验证')
    add_body(doc, '以下数字来自 1000 条固定种子随机报文（Node v22）与 300 次蒙特卡洛模拟，'
             '同一口径在网页中也可现场复现：')
    add_table(doc,
        ['指标', 'JSON 整包', 'gzip', '单体位打包', '三层合计', 'L0 信标'],
        [
            ['平均体积（B）', 287.6, 270.2, 83.9, 85.9, 5],
            ['相对 JSON（倍）', '1.00', '1.06', '3.43', '3.35', '57.52'],
        ],
        widths=[3.6, 2.5, 2.3, 2.7, 2.5, 2.4],
        first_col_left=True,
    )
    add_caption(doc, '表3 1000 条随机报文体积基准')
    n = B['network']
    sec = lambda v: '%.2f' % (v / 1000.0)
    add_table(doc,
        ['弱网指标', 'JSON 整包', 'L0 信标'],
        [
            ['平均送达时间（s）', sec(n['json']['meanMs']), sec(n['l0']['meanMs'])],
            ['p50 / p95（s）',
             '%s / %s' % (sec(n['json']['p50']), sec(n['json']['p95'])),
             '%s / %s' % (sec(n['l0']['p50']), sec(n['l0']['p95']))],
            ['30 秒成功率', '%.1f%%' % (n['json']['successRate'] * 100),
             '%.1f%%' % (n['l0']['successRate'] * 100)],
            ['能量（模型，J）', B['energy']['json'], B['energy']['l0']],
        ],
        widths=[5.2, 5.4, 5.4],
    )
    add_caption(doc, '表4 默认窄带下的送达表现（MC300）')
    add_body(doc, '首个可行动情报提速约 %.1f 倍；编解码均为亚毫秒级，'
             '说明方案的真正差距在字节与信道，而不在 CPU。' % B['ratios']['ttfa'])

    add_h(doc, 1, '六、风险、局限与结论')
    add_body(doc, '局限有三：其一，弱网与能量是模型化仿真，系数为公开数量级，不能替代真实链路测量；'
             '其二，静态 Huffman 针对应急语料训练，对语料外文本不保证最优压缩；'
             '其三，本作品是教学与演示型设计，并未实现真实无线电收发。')
    add_body(doc, '结论：在显式声明的资源约束下，分层协议以约 30% 的体积、约 1/12 的时间、'
             '约 1/12 的能量，把最能改变行动的信息先送达，并支持逐层优雅降级。'
             '作品验证了核心主张——高效不只是更小，而是把对的信息在对的时刻送达。')

    out = os.path.join(ROOT, '核心设计决策与技术取舍.docx')
    doc.save(out)
    print('saved', out)


# ===================== 文档二：团队的思考与判断 =====================

def doc_reflection():
    doc = init_document()
    add_title(doc, '1% Battery 团队的思考与判断',
              '北师港浸会 AI 赛道编程马拉松 · 工程与社会价值方向')

    add_h(doc, 1, '一、我们如何理解这个题目')
    add_body(doc, '看到“1% Battery”时，团队的第一反应是做一个压缩算法。但讨论后我们否定了这个方向：'
             '如果目标只是“更小”，题目更接近一道压缩题；而“在受限资源下完成任务”的关键词是“完成任务”，'
             '不是“压缩数据”。1% 电量真正逼迫人回答的，是信息的优先级问题。')
    add_body(doc, '我们最终把题目理解为一句话：当资源只剩一点点时，技术是否还记得自己为何而存在。'
             '求救信息的价值不是平均分布的——“有人、在哪个山谷、有多危急”足以启动救援，'
             '而完整的伤情描述可以随后补发。于是作品的核心从“压缩”转向“排序”。')

    add_h(doc, 1, '二、思考过程中的几个关键追问')

    add_h(doc, 2, '追问一：1% 到底意味着什么')
    add_body(doc, '我们把它量化。一台 3000 mAh 手机的 1% 约 410 J，'
             '按无线电 0.8 W 估算，只够射频工作约 8 分钟。'
             '在 600 bps 窄带下，410 J 能传输的字节数同样有限。'
             '把“1%”落到焦耳和秒，作品的资源约束才有了可以被检验的形态。')

    add_h(doc, 2, '追问二：信息的价值如何排序')
    add_body(doc, '团队按“能否改变行动”给信息排序。L0 信标回答“有没有人、在哪里、急不急”，'
             '是不可缺失的最小集合；L1 给出精确位置与需求；L2 才是细节。'
             '这一排序直接决定了位布局：最关键的信息最短、最先发、最容易在弱网中成活。')

    add_h(doc, 2, '追问三：为什么不让接收端等整包')
    add_body(doc, '在丢包 30% 的信道上，9 个包全部到达的概率是 0.7 的 9 次方，约 4%；'
             '而 1 个包到达的概率是 70%。这不是“慢一点”的差别，而是几何级数的生死差距。'
             '数学让我们确信：分层不是为了好看，而是弱网下唯一稳健的结构。')

    add_h(doc, 2, '追问四：要不要把模型做得更“聪明”')
    add_body(doc, '团队一度考虑在线学习词频、自动扩展词典。但我们判断：'
             '在“为 1% 而建”的场景里，任何运行时的模型调用都违背初衷——'
             '没有网络、没有算力、也没有时间。把训练放在离线、把模型预装，'
             '才是诚实的选择。同时我们把动态方案也实现出来，用真实表头成本证明这一判断。')

    add_h(doc, 1, '三、关键判断与取舍')
    add_table(doc,
        ['判断点', '团队的结论', '主要理由'],
        [
            ['核心是压缩还是排序', '排序（优先级）', '任务导向，而非体积导向'],
            ['静态还是动态模型', '静态预装', '运行时零流量，短报文更优'],
            ['框架还是原生', '原生零依赖', '作品本身即理念的自证'],
            ['默认参数是否预设结论', '提供对照且可调', '避免“为了赢而选参数”'],
            ['模拟数据如何呈现', '区分实测与模型', '不把估算说成测量'],
        ],
        widths=[4.6, 4.8, 6.6],
    )
    add_caption(doc, '表1 团队的关键判断')
    add_body(doc, '团队内部也有分歧：默认参数若选得太极端，会被质疑“为了结论而选条件”；'
             '选得太温和，对比又不明显。最终的处理是：默认信道采用合理的灾后 2G 口径，'
             '同时提供全部参数滑块与四个预设档位，让评委可以把条件调到“JSON 也能成功”，'
             '亲眼看到两种方案在不同条件下的真实分界。')

    add_h(doc, 1, '四、哲学层面的思考')
    add_body(doc, '1% 是一种技术的自我克制。常规软件默认资源充足，于是不断堆叠功能、依赖与体积；'
             '而本作品要求每个字段证明自己值得被发送。这种克制背后是对“为谁而建”的回答——'
             '它不是为最舒适的使用场景而建，而是为最脆弱、最需要被听见的时刻而建。')
    add_body(doc, '我们由此接受“残缺不等于无用”：L0 不完整，但它足以派人；L2 缺失，'
             '但救援已经启动。优雅降级不是失败后的妥协，而是一开始就设计好的善意。')

    add_h(doc, 1, '五、对 AI 协作的思考')
    add_body(doc, '本作品大量借助 AI 完成编码与调试。团队对 AI 的定位是“高速执行者”，'
             '而不是“结论的来源”。所有关键数字由算法与测试产出，AI 没有被允许直接填写结论；'
             '我们通过 20 项单元测试、往返校验、蒙特卡洛与解析期望的交叉验证来把关。')
    add_body(doc, '经验性的判断是：AI 能显著加快实现，但越是这样，越需要可复现的证据链'
             '来约束它，也约束我们自己。')

    add_h(doc, 1, '六、不足、未来方向与结语')
    add_body(doc, '不足在于：网络与能量为仿真而非实测；词典与语料规模有限；'
             '没有对接真实的无线电或卫星链路。未来若继续，可接入真实 LoRa/卫星短报文硬件，'
             '扩充多语料词典，并以实测数据校准能量模型。')
    add_body(doc, '结语：1% Battery 想传达的，不是“省”，而是“值得”。'
             '最后 1% 不留给最复杂的功能，而留给最需要被听见的声音。'
             '当每一个字节都为重要的事而设计，1% 已足够走得足够远——远到被听见。')

    out = os.path.join(ROOT, '团队的思考与判断.docx')
    doc.save(out)
    print('saved', out)


if __name__ == '__main__':
    doc_decisions()
    doc_reflection()
