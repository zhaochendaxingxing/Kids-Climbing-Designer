'use client';

import Image from 'next/image';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  CircleHelp,
  Cuboid,
  Download,
  FolderOpen,
  Grid2X2,
  Hand,
  House,
  Layers3,
  LayoutGrid,
  Maximize2,
  Minus,
  MousePointer2,
  Move,
  Plus,
  Rotate3D,
  Settings2,
  ChartNoAxesColumn,
  Search,
  X,
} from 'lucide-react';
import { PART_COLORS } from '@/data/parts';
import { PREVIEW_PARTS, usePartThumbnails } from './PreviewScene';
import type { PreviewSettings, ViewCommand } from './PreviewScene';
import styles from './preview.module.css';

const Scene = dynamic(() => import('./PreviewScene'), { ssr: false });
const MODES = [
  { label: '生成框架', icon: Cuboid },
  { label: '增加框架', icon: Layers3 },
  { label: '增加配件', icon: Box },
  { label: '移动配件', icon: Move },
];
const COLORS = PART_COLORS.filter((color) =>
  ['olive', 'blue', 'orange', 'mint', 'white'].includes(color.id),
);
const TABS = [
  { label: '配件库', icon: LayoutGrid },
  { label: '基本模块', icon: Layers3 },
  { label: '方案', icon: FolderOpen },
  { label: '统计', icon: ChartNoAxesColumn },
];

export default function VisualPreview() {
  const [settings, setSettings] = useState<PreviewSettings>({
    layers: 2,
    columns: 2,
    depth: 2,
    color: '#6B7F4A',
    grid: true,
    pan: false,
  });
  const [draft, setDraft] = useState({ layers: 2, columns: 2, depth: 2 });
  const [command, setCommand] = useState<ViewCommand>({
    action: 'home',
    sequence: 0,
  });
  const [mode, setMode] = useState('生成框架');
  const [tab, setTab] = useState('配件库');
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(PREVIEW_PARTS[0]);
  const [ready, setReady] = useState(false);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState('');
  const onReady = useCallback((value: boolean) => setReady(value), []);
  const thumbnails = usePartThumbnails(PREVIEW_PARTS, settings.color);
  const view = (action: ViewCommand['action']) =>
    setCommand((value) => ({ action, sequence: value.sequence + 1 }));
  const visibleParts = PREVIEW_PARTS.filter((part) => {
    const matchesCategory =
      category === '全部' ||
      part.category ===
        { 杆件: 'bar', 连接件: 'connector', 平台板: 'platform' }[category];
    return matchesCategory && part.name.includes(search.trim());
  });
  const exportPreview = () => {
    const blob = new Blob(
      [JSON.stringify({ type: 'visual-preview', settings }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '攀爬架视觉预览配置.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('预览配置已导出');
  };

  return (
    <div className={styles.app} lang="zh-CN">
      <a className={styles['skip-link']} href="#preview-workspace">
        跳到模型预览
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="返回攀爬架设计器">
          <span className={styles['brand-mark']}>
            <Cuboid size={26} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span>
            <strong>攀爬架设计器</strong>
            <small>让每一个想法，都搭得起来。</small>
          </span>
        </Link>
        <div className={styles['project-title']}>
          <span className={styles['project-dot']} />
          双层探索架<span className={styles['preview-tag']}>视觉预览</span>
        </div>
        <div className={styles['header-actions']}>
          <button className={styles['export-button']} onClick={exportPreview}>
            <Download size={16} aria-hidden="true" />
            <span>导出预览配置</span>
          </button>
          <Link href="/" className={styles['open-editor']}>
            打开设计器
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div
          className={styles['mode-switch']}
          role="group"
          aria-label="工作模式预览"
        >
          {MODES.map(({ label, icon: Icon }) => (
            <button
              key={label}
              aria-pressed={mode === label}
              className={mode === label ? styles['active-mode'] : ''}
              onClick={() => {
                setMode(label);
                setNotice(
                  label === '生成框架'
                    ? ''
                    : '当前展示工作模式样式，完整搭建操作请打开设计器',
                );
              }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div
          className={styles['view-tools']}
          role="group"
          aria-label="视角操作"
        >
          <button
            aria-label="旋转视角"
            title="拖动旋转视角"
            aria-pressed={!settings.pan}
            className={!settings.pan ? styles['active-tool'] : ''}
            onClick={() => setSettings((value) => ({ ...value, pan: false }))}
          >
            <Rotate3D size={18} aria-hidden="true" />
          </button>
          <button
            aria-label="平移视角"
            title="拖动平移视角"
            aria-pressed={settings.pan}
            className={settings.pan ? styles['active-tool'] : ''}
            onClick={() => setSettings((value) => ({ ...value, pan: true }))}
          >
            <Hand size={17} aria-hidden="true" />
          </button>
          <span className={styles['tool-divider']} />
          <button
            aria-label="居中模型"
            title="居中模型"
            onClick={() => view('home')}
          >
            <Maximize2 size={17} aria-hidden="true" />
          </button>
          <button
            aria-label="显示网格"
            title="显示网格"
            aria-pressed={settings.grid}
            className={settings.grid ? styles['active-tool'] : ''}
            onClick={() =>
              setSettings((value) => ({ ...value, grid: !value.grid }))
            }
          >
            <Grid2X2 size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.workspace}>
        <main id="preview-workspace" className={styles.stage}>
          <div className={styles['scene-viewport']} data-parameters={mode === '生成框架'}>
            <Scene settings={settings} command={command} onReady={onReady} />
          </div>
          <div className={styles['stage-topline']}>
            <span>
              <span className={styles['live-dot']} />
              3D 模型预览
            </span>
            <button
              className={styles['text-button']}
              onClick={() => view('home')}
            >
              透视视图
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          </div>
          {mode === '生成框架' && (
            <section className={styles.parameters} aria-label="框架参数">
              <div className={styles['parameter-title']}>
                <Settings2 size={16} aria-hidden="true" />
                <strong>框架尺寸</strong>
                <span>每格 40 cm</span>
              </div>
              <div className={styles['parameter-fields']}>
                {(
                  [
                    { key: 'layers', label: '层数' },
                    { key: 'columns', label: '列数' },
                    { key: 'depth', label: '纵深' },
                  ] as const
                ).map(({ key, label }) => (
                  <label key={key}>
                    {label}
                    <select
                      name={key}
                      value={draft[key]}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          [key]: Number(event.target.value),
                        }))
                      }
                    >
                      {[1, 2, 3].map((number) => (
                        <option key={number} value={number}>
                          {number} 格
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                className={styles['generate-button']}
                onClick={() => {
                  setSettings((value) => ({ ...value, ...draft }));
                  view('home');
                  setNotice('示例框架已更新');
                }}
              >
                <Plus size={16} aria-hidden="true" />
                生成框架
              </button>
            </section>
          )}
          {!ready && (
            <div className={styles.loading} role="status">
              正在加载模型…
            </div>
          )}
          <div className={styles['scene-caption']}>
            <span>示例模型</span>
            <strong>双层探索架</strong>
            <p>自由组合，从一个框架开始。</p>
          </div>
          <div className={styles['camera-controls']}>
            <button
              aria-label="放大模型"
              title="放大模型"
              onClick={() => view('in')}
            >
              <Plus size={19} aria-hidden="true" />
            </button>
            <button
              aria-label="缩小模型"
              title="缩小模型"
              onClick={() => view('out')}
            >
              <Minus size={19} aria-hidden="true" />
            </button>
            <span />
            <button
              aria-label="恢复默认视角"
              title="恢复默认视角"
              onClick={() => view('home')}
            >
              <House size={18} aria-hidden="true" />
            </button>
          </div>
          <div className={styles['stage-bottom']}>
            <span>
              <MousePointer2 size={14} aria-hidden="true" />
              拖动{settings.pan ? '平移' : '旋转'}
              <span className={styles['hint-divider']} />
              滚轮缩放
            </span>
            <button
              aria-label="查看预览操作说明"
              onClick={() => setHelp((value) => !value)}
              aria-expanded={help}
            >
              <CircleHelp size={18} aria-hidden="true" />
            </button>
          </div>
          {help && (
            <div className={styles.help}>
              <button aria-label="关闭说明" onClick={() => setHelp(false)}>
                <X size={15} aria-hidden="true" />
              </button>
              <strong>查看你的搭建效果</strong>
              <p>
                拖动模型区域旋转，切换手掌图标后平移。点击右侧色点可预览杆件配色。
              </p>
              <p>
                此页用于确认视觉方案。完整的配件放置与方案保存可在设计器中操作。
              </p>
            </div>
          )}
        </main>

        <aside className={styles.sidebar} aria-label="配件和方案预览">
          <nav className={styles['sidebar-tabs']} aria-label="侧栏功能">
            {TABS.map(({ label, icon: Icon }) => (
              <button
                key={label}
                aria-pressed={tab === label}
                className={tab === label ? styles['active-tab'] : ''}
                onClick={() => setTab(label)}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
          <div className={styles['sidebar-body']}>
            <div className={styles['sidebar-heading']}>
              <h1>{tab === '配件库' ? '挑选你的配件' : tab}</h1>
              <span>{tab === '配件库' ? '基础配件' : '示例预览'}</span>
            </div>
            {tab === '配件库' && (
              <>
                <label className={styles.search}>
                  <Search size={16} aria-hidden="true" />
                  <input
                    aria-label="搜索预览配件"
                    name="part-search"
                    autoComplete="off"
                    placeholder="搜索配件名称…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {search && (
                    <button aria-label="清除搜索" onClick={() => setSearch('')}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </label>
                <div
                  className={styles.categories}
                  role="group"
                  aria-label="配件分类"
                >
                  {['全部', '杆件', '连接件', '平台板'].map((label) => (
                    <button
                      key={label}
                      aria-pressed={category === label}
                      className={
                        category === label ? styles['selected-category'] : ''
                      }
                      onClick={() => setCategory(label)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles['parts-grid']}>
                  {visibleParts.map((part) => (
                    <button
                      key={part.id}
                      className={`${styles['part-card']} ${selected.id === part.id ? styles['selected-part'] : ''}`}
                      aria-pressed={selected.id === part.id}
                      onClick={() => setSelected(part)}
                    >
                      <div className={styles['part-image']}>
                        {thumbnails[part.id] ? (
                          <Image unoptimized
                            src={thumbnails[part.id]}
                            width={144}
                            height={88}
                            alt=""
                          />
                        ) : (
                          <Box size={30} aria-hidden="true" />
                        )}
                        {selected.id === part.id && (
                          <span className={styles['part-check']}>
                            <Check size={11} aria-hidden="true" />
                          </span>
                        )}
                      </div>
                      <strong>
                        {part.name.replace(
                          /\s?\d+(\.\d+)?(x\d+(\.\d+)?)?CM/i,
                          '',
                        )}
                      </strong>
                      <span>
                        {part.barSpec
                          ? `长度 ${part.barSpec.length} cm`
                          : part.connectorSpec
                            ? '适配 4 cm 圆管'
                            : `${part.size.width} × ${part.size.depth} cm`}
                      </span>
                    </button>
                  ))}
                </div>
                {visibleParts.length === 0 && (
                  <p className={styles.empty}>
                    没有找到匹配配件，请更换搜索词。
                  </p>
                )}
                <div className={styles['selected-detail']}>
                  <span>当前选择</span>
                  <strong>{selected.name}</strong>
                  <p>{selected.description}</p>
                </div>
              </>
            )}
            {tab === '基本模块' && (
              <div className={styles['module-card']}>
                <Cuboid size={40} strokeWidth={1} aria-hidden="true" />
                <h2>双层探索架</h2>
                <p>2 层 × 2 列 × 2 格纵深</p>
                <button
                  onClick={() => {
                    const size = { layers: 2, columns: 2, depth: 2 };
                    setDraft(size);
                    setSettings((value) => ({ ...value, ...size }));
                    view('home');
                    setNotice('已恢复示例框架');
                  }}
                >
                  预览此模块
                </button>
              </div>
            )}
            {tab === '方案' && (
              <div className={styles['empty-panel']}>
                <FolderOpen size={32} aria-hidden="true" />
                <h2>继续你的搭建</h2>
                <p>打开完整设计器，查看和保存你的实际方案。</p>
                <Link href="/">
                  打开设计器
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </div>
            )}
            {tab === '统计' && (
              <div className={styles.statistics}>
                <h2>示例框架尺寸</h2>
                {[
                  { label: '宽度', value: settings.columns * 40 },
                  { label: '纵深', value: settings.depth * 40 },
                  {
                    label: '高度（含屋顶）',
                    value: settings.layers * 40 + settings.columns * 20 + 4,
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>
                      {item.value}
                      <small>cm</small>
                    </strong>
                  </div>
                ))}
                <p>尺寸用于视觉示例，正式用料以完整设计器统计为准。</p>
              </div>
            )}
          </div>
          <section className={styles.palette} aria-label="模型杆件配色">
            <div>
              <strong>试试不同的配色</strong>
              <span>
                {COLORS.find((color) => color.hex === settings.color)?.name}
              </span>
            </div>
            <div className={styles.swatches}>
              {COLORS.map((color) => (
                <button
                  key={color.id}
                  aria-label={`模型配色：${color.name}`}
                  aria-pressed={settings.color === color.hex}
                  title={color.name}
                  style={{ '--swatch': color.hex } as React.CSSProperties}
                  onClick={() =>
                    setSettings((value) => ({ ...value, color: color.hex }))
                  }
                >
                  {settings.color === color.hex && (
                    <Check size={15} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </section>
          <div className={styles['sidebar-foot']}>
            <Box size={15} aria-hidden="true" />
            <span>点击卡片查看配件 · 点击色点预览配色</span>
          </div>
        </aside>
      </div>
      <footer className={styles.footer}>
        <span>
          <span className={styles['live-dot']} />
          {ready ? '预览就绪' : '加载中…'}
          <span className={styles['footer-divider']} />
          单位 cm
        </span>
        <span className={styles.feedback} role="status" aria-live="polite">
          {notice || '视觉方案预览 · 示例模型'}
        </span>
        <Link href="/">
          <ArrowLeft size={13} aria-hidden="true" />
          返回完整设计器
        </Link>
      </footer>
    </div>
  );
}
