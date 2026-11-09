import { useState, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import PartThumbnail from '@/components/three/PartThumbnail';
import { Button, Modal, Input, message, Popconfirm, Tag, Empty, Tooltip } from 'antd';
import {
  SaveOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  EditOutlined,
  DownloadOutlined,
  BarChartOutlined,
  DiffOutlined,
  AppstoreOutlined,
  LayoutOutlined,
  DragOutlined,
  DoubleRightOutlined,
  LeftOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CloseOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useStore } from '@/store/useStore';
import type { PartCategory, PresetUnit, PartDefinition } from '@/types/parts';
import { CATEGORY_CONFIG, PARTS_LIBRARY, PART_COLORS, CONNECTOR_COLORS, PRESET_UNITS, COMBO_45L, EXT_BARS, EXT_PLATES, getPartById } from '@/data/parts';

// ==================== DESIGN.md 色彩令牌 ====================
const C = {
  primary: '#4A90D9',
  primarySoft: '#E3EFFB',
  accent: '#FF9F43',
  accentSoft: '#FFF3E6',
  success: '#26C281',
  successSoft: '#E6F7EF',
  error: '#EE5A5A',
  errorSoft: '#FDEEEE',
  warn: '#F7CA45',
  warnSoft: '#FEF7DD',
  bg: '#FFFFFF',
  card: '#FFFFFF',
  text: '#283544',
  text2: '#6B7887',
  line: '#EEF1F4',
  railBg: '#FFFFFF',
};

// ==================== 基本配件网格 ====================
function PartCard({
  part,
  onPick,
}: {
  part: PartDefinition;
  onPick: (partId: string, colorId: string) => void;
}) {
  const [selectedColor, setSelectedColor] = useState(part.defaultColor);
  const draggingPart = useStore((state) => state.draggingPart);
  const active = draggingPart?.partId === part.id;
  const colorHex =
    (part.category === 'connector' ? CONNECTOR_COLORS : PART_COLORS).find(
      (color) => color.id === selectedColor,
    )?.hex || '#6B7F4A';
  const dimensions = part.barSpec
    ? `长度 ${part.barSpec.length} cm`
    : part.connectorSpec
      ? '适配 4 cm 圆管'
      : `${part.size.width} × ${part.size.depth} cm`;

  return (
    <article className="designer-part-card" data-active={active}>
      <button
        className="designer-part-select"
        aria-label={`选择${part.name}`}
        aria-pressed={active}
        draggable
        onDragStart={() => onPick(part.id, selectedColor)}
        onClick={() => onPick(part.id, selectedColor)}
      >
        <PartThumbnail part={part} color={colorHex} />
        {active && (
          <span className="designer-part-check">
            <Check size={11} aria-hidden="true" />
          </span>
        )}
        <strong>{part.name}</strong>
        <span>{dimensions}</span>
      </button>
      {part.category !== 'connector' && (
        <div
          className="designer-part-colors"
          role="group"
          aria-label={`${part.name}配色`}
        >
          {part.colors.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-label={`${part.name}：${color.name}`}
              aria-pressed={selectedColor === color.id}
              title={color.name}
              style={{ '--part-color': color.hex } as React.CSSProperties}
              onClick={() => {
                setSelectedColor(color.id);
                if (active) onPick(part.id, color.id);
              }}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function BasicPartsGrid() {
  const setDraggingPart = useStore((state) => state.setDraggingPart);
  const setPendingPreset = useStore((state) => state.setPendingPreset);
  const [category, setCategory] = useState<PartCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const partsByCategory = useMemo(() => {
    const result: Record<PartCategory, PartDefinition[]> = {
      bar: [],
      connector: [],
      platform: [],
    };
    PARTS_LIBRARY.forEach((part) => {
      if (part.id === 'connector-45deg-nest' || part.extension) return;
      if (part.name.toLowerCase().includes(query.trim().toLowerCase()))
        result[part.category].push(part);
    });
    return result;
  }, [query]);
  const categories =
    category === 'all'
      ? (Object.keys(CATEGORY_CONFIG) as PartCategory[])
      : [category];
  const comboVisible =
    categories.includes('connector') && COMBO_45L.name.includes(query.trim());
  const pick = (partId: string, colorId: string) =>
    setDraggingPart({ partId, colorId });
  const armCombo = () => {
    setPendingPreset({
      id: COMBO_45L.id,
      name: COMBO_45L.name,
      parts: COMBO_45L.parts,
    });
    message.success(
      `已选中「${COMBO_45L.name}」，点击场景地面部署（Esc 取消）`,
    );
  };

  return (
    <div className="designer-library">
      <label className="designer-search">
        <Search size={16} aria-hidden="true" />
        <input
          name="part-search"
          aria-label="搜索配件"
          autoComplete="off"
          placeholder="搜索配件名称…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="designer-categories" role="group" aria-label="配件分类">
        <button
          aria-pressed={category === 'all'}
          onClick={() => setCategory('all')}
        >
          全部
        </button>
        {(Object.keys(CATEGORY_CONFIG) as PartCategory[]).map((key) => (
          <button
            key={key}
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            {CATEGORY_CONFIG[key].name}
          </button>
        ))}
      </div>
      {categories.map((cat) => {
        const parts = partsByCategory[cat];
        if (parts.length === 0 && !(cat === 'connector' && comboVisible))
          return null;
        return (
          <section
            key={cat}
            className="designer-part-section"
            aria-label={CATEGORY_CONFIG[cat].name}
          >
            <h3>
              {CATEGORY_CONFIG[cat].name}
              <span>{CATEGORY_CONFIG[cat].description}</span>
            </h3>
            <div className="designer-parts-grid">
              {parts.map((part) => (
                <PartCard key={part.id} part={part} onPick={pick} />
              ))}
              {cat === 'connector' && comboVisible && (
                <button className="designer-combo-card" onClick={armCombo}>
                  <div className="designer-combo-images">
                    {COMBO_45L.parts.map((item) => {
                      const definition = getPartById(item.partId);
                      return definition ? (
                        <PartThumbnail
                          key={item.id}
                          part={definition}
                          color="#2B2B2B"
                        />
                      ) : null;
                    })}
                  </div>
                  <strong>{COMBO_45L.name}</strong>
                  <span>两件嵌套组合</span>
                </button>
              )}
            </div>
          </section>
        );
      })}
      {!comboVisible &&
        categories.every((key) => partsByCategory[key].length === 0) && (
          <Empty
            description="没有匹配的配件，请更换搜索词"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
    </div>
  );
}

// ==================== 扩展配件（扩展杆件 / 扩展板件） ====================
function ExtensionPartsGrid() {
  const setDraggingPart = useStore((state) => state.setDraggingPart);

  const pick = (partId: string, colorId: string) => setDraggingPart({ partId, colorId });

  const section = (title: string, desc: string, parts: PartDefinition[]) => {
    if (parts.length === 0) return null;
    return (
      <div>
        <div className="text-[11px] font-medium mb-1.5 flex items-center gap-1" style={{ color: C.text2 }}>
          {title} <span className="text-[10px]">· {desc}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {parts.map((part) => <PartCard key={part.id} part={part} onPick={pick} />)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[12px] rounded-lg px-2 py-2" style={{ background: C.accentSoft, color: '#D97A1E' }}>
        <LayoutOutlined /> 扩展配件可由基本「杆件 / 平台板」右键「替换为扩展件」得到
      </div>
      {section('扩展杆件', '35CM 管 + 方向盘', EXT_BARS)}
      {section('扩展板件', '玻璃 / 布兜 / 造型板 / 攀岩 / 收纳 / 太空舱', EXT_PLATES)}
      {EXT_BARS.length === 0 && EXT_PLATES.length === 0 && <Empty description="暂无扩展配件" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </div>
  );
}

// ==================== 预设单元（基本模块） ====================
function PresetsPanel() {
  const setPendingPreset = useStore((state) => state.setPendingPreset);
  const pendingPreset = useStore((state) => state.pendingPreset);

  const armPreset = (preset: PresetUnit) => {
    setPendingPreset({ id: preset.id, name: preset.name, parts: preset.parts });
    message.success(`已选中「${preset.name}」，点击场景地面部署（Esc 取消）`);
  };

  return (
    <div className="space-y-3">
      <div className="text-[12px] rounded-lg px-2 py-2" style={{ background: C.accentSoft, color: '#D97A1E' }}>
        拖出或点击模块，到 3D 场景中单击地面整体部署
      </div>
      {PRESET_UNITS.map((preset) => {
        const active = pendingPreset?.id === preset.id;
        return (
          <div
            key={preset.id}
            draggable
            onDragStart={() => armPreset(preset)}
            onClick={() => armPreset(preset)}
            className="p-3 rounded-xl bg-white border cursor-grab select-none transition-all"
            style={{
              borderColor: active ? C.accent : 'transparent',
              boxShadow: active ? `0 0 0 2px rgba(255,159,67,0.35)` : '0 2px 8px rgba(0,0,0,0.06)',
            }}
          >
            <div className="flex items-center gap-3">
              {/* 预览缩略 */}
              <div className="w-14 h-12 rounded-lg shrink-0 grid place-items-center" style={{ background: 'rgba(38,194,129,0.12)' }}>
                <svg viewBox="0 0 48 40" className="w-9 h-8">
                  <rect x="5" y="18" width="38" height="3" rx="1.5" fill="#6BCB77" />
                  <rect x="5" y="18" width="3" height="3" rx="1.5" fill="#333" />
                  <rect x="40" y="18" width="3" height="3" rx="1.5" fill="#333" />
                  <rect x="5" y="24" width="38" height="2" rx="1" fill="#6BCB77" opacity="0.45" />
                  <rect x="5" y="24" width="2" height="2" fill="#333" opacity="0.6" />
                  <rect x="41" y="24" width="2" height="2" fill="#333" opacity="0.6" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: C.text }}>
                  {preset.name}
                </div>
                <div className="text-[11px] mt-0.5 truncate" style={{ color: C.text2 }}>
                  {preset.parts.length} 件 · {preset.category}
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0" style={{ background: C.accentSoft, color: '#D97A1E' }}>
                <DragOutlined /> 拖出
              </span>
            </div>
            <div className="text-[11px] mt-2" style={{ color: C.text2 }}>
              {preset.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== 统计信息 ====================
function PartsSummary() {
  const getPartsSummary = useStore((state) => state.getPartsSummary);
  const parts = useStore((state) => state.parts);
  const exportJSON = useStore((state) => state.exportJSON);
  const exportCSV = useStore((state) => state.exportCSV);

  const summary = useMemo(() => getPartsSummary(), [getPartsSummary, parts]);
  const totalCount = useMemo(() => summary.reduce((sum, i) => sum + i.count, 0), [summary]);

  const groupedByCategory = useMemo(() => {
    const result: Record<string, typeof summary> = {};
    summary.forEach((item) => {
      (result[item.category] = result[item.category] || []).push(item);
    });
    return result;
  }, [summary]);

  const catTotal = (cat: string) => (groupedByCategory[cat] || []).reduce((s, i) => s + i.count, 0);
  const catMeta: Record<string, { label: string; color: string }> = {
    bar: { label: '杆件', color: C.primary },
    connector: { label: '连接件', color: C.accent },
    platform: { label: '平台板', color: C.success },
  };

  const doExport = (kind: 'json' | 'csv') => {
    const content = kind === 'json' ? exportJSON() : exportCSV();
    const blob = new Blob([kind === 'csv' ? `\uFEFF${content}` : content], {
      type: kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'json' ? `攀爬架设计_${new Date().toLocaleDateString()}.json` : `配件清单_${new Date().toLocaleDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(kind === 'json' ? 'JSON 导出成功' : 'CSV 导出成功');
  };

  const counts = ['bar', 'connector', 'platform'].map((cat) => ({ cat, n: catTotal(cat) }));

  return (
    <div className="space-y-3">
      {/* 计数卡 */}
      <div className="grid grid-cols-2 gap-2.5">
        {counts.map(({ cat, n }) => (
          <div key={cat} className="rounded-xl bg-white p-3 text-center" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div className="text-[22px] font-bold leading-none" style={{ color: catMeta[cat].color }}>{n}</div>
            <div className="text-[11px] mt-1" style={{ color: C.text2 }}>{catMeta[cat].label}</div>
          </div>
        ))}
        <div
          className="rounded-xl p-3 border-2 flex-1 min-w-full col-span-2 text-center"
          style={{ borderStyle: 'dashed', borderColor: C.line, background: C.primarySoft }}
        >
          <span className="text-[13px] font-semibold" style={{ color: C.primary }}>共 {totalCount} 件</span>
        </div>
      </div>

      {parts.length === 0 ? (
        <div className="py-4"><Empty description="暂无配件" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
      ) : (
        <>
          {/* 用料构成 */}
          <div className="rounded-xl bg-white p-3" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div className="text-[12px] font-medium mb-2 flex items-center justify-between" style={{ color: C.text }}>
              <span>用料构成</span>
              <span className="text-[10px]" style={{ color: C.text2 }}>单位：件</span>
            </div>
            <div className="space-y-2">
              {counts.map(({ cat, n }) => (
                <div key={cat}>
                  <div className="flex justify-between text-[11px] mb-1" style={{ color: C.text2 }}>
                    <span>{catMeta[cat].label}</span>
                    <span>{n} / {totalCount}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: C.bg }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: totalCount ? `${(n / totalCount) * 100}%` : '0%', background: catMeta[cat].color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 分类明细 */}
          {Object.entries(groupedByCategory).map(([category, items]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-medium" style={{ color: C.text2 }}>{catMeta[category]?.label || category}</span>
                <span className="text-[10px]" style={{ color: C.text2 }}>{catTotal(category)} 件</span>
              </div>
              <div className="rounded-xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                {items.map((item) => (
                  <div key={item.partId} className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                    <span className="text-[13px]" style={{ color: C.text }}>{item.partName}</span>
                    <span className="text-[13px] font-semibold" style={{ color: C.primary }}>× {item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* 导出 */}
      <div className="flex gap-2">
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() => doExport('json')}
          className="flex-1 rounded-full text-[13px]"
          style={{ background: C.primary }}
        >
          导出 JSON
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => doExport('csv')}
          className="flex-1 rounded-full text-[13px]"
          style={{ borderColor: C.line, color: C.text }}
        >
          导出 CSV
        </Button>
      </div>
    </div>
  );
}

// ==================== 存储方案 ====================
function ProjectsPanel() {
  const projects = useStore((state) => state.projects);
  const currentProjectId = useStore((state) => state.currentProjectId);
  const saveProject = useStore((state) => state.saveProject);
  const loadProject = useStore((state) => state.loadProject);
  const deleteProject = useStore((state) => state.deleteProject);
  const duplicateProject = useStore((state) => state.duplicateProject);
  const renameProject = useStore((state) => state.renameProject);
  const newProject = useStore((state) => state.newProject);
  const startCompare = useStore((state) => state.startCompare);
  const viewMode = useStore((state) => state.viewMode);

  const [renameModal, setRenameModal] = useState<{ visible: boolean; id: string; name: string }>({ visible: false, id: '', name: '' });
  const [saveName, setSaveName] = useState('');

  const handleSave = () => {
    const current = useStore.getState().getCurrentProject();
    setSaveName(current?.name || '我的框架');
  };

  const confirmSave = () => {
    saveProject(saveName || '我的框架');
    setSaveName('');
    message.success('方案保存成功');
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-3">
      {/* 顶部操作 */}
      <div className="flex gap-2">
        <Button icon={<PlusOutlined />} onClick={newProject} className="flex-1 rounded-full text-[13px]" style={{ borderColor: C.line, color: C.text }}>
          新建
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          className="flex-1 rounded-full text-[13px]"
          style={{ background: C.primary }}
        >
          保存
        </Button>
      </div>

      <div className="text-[11px] font-medium" style={{ color: C.text2 }}>方案列表</div>
      <div className="space-y-2.5 max-h-[46vh] overflow-y-auto">
        {projects.length === 0 ? (
          <Empty description="暂无方案" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          projects.map((project) => {
            const active = currentProjectId === project.id;
            return (
              <div
                key={project.id}
                className="rounded-xl bg-white p-3 cursor-pointer transition-all"
                style={{
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  border: `2px solid ${active ? C.primary : 'transparent'}`,
                }}
                onClick={() => loadProject(project.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center min-w-0 gap-2">
                    <FolderOpenOutlined style={{ color: active ? C.primary : C.accent }} />
                    <span className="text-[13px] font-medium truncate" style={{ color: C.text }}>{project.name}</span>
                  </div>
                  {active && <span className="px-1.5 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: C.primarySoft, color: C.primary }}>当前</span>}
                </div>
                <div className="text-[11px] mt-1" style={{ color: C.text2 }}>
                  {project.parts.length} 配件 · {formatDate(project.updatedAt)}
                </div>
                <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="重命名">
                    <Button type="text" size="small" icon={<EditOutlined />} className="h-6 px-1" style={{ color: C.text2 }} onClick={() => setRenameModal({ visible: true, id: project.id, name: project.name })} />
                  </Tooltip>
                  <Tooltip title="复制">
                    <Button type="text" size="small" icon={<CopyOutlined />} className="h-6 px-1" style={{ color: C.text2 }} onClick={() => { duplicateProject(project.id); message.success('已复制方案'); }} />
                  </Tooltip>
                  <Tooltip title="对比">
                    <Button
                      type="text"
                      size="small"
                      icon={<DiffOutlined />}
                      disabled={currentProjectId === project.id || viewMode === 'diff'}
                      className="h-6 px-1"
                      style={{ color: C.text2 }}
                      onClick={() => { startCompare(project.id); message.info('对比模式已开启'); }}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="确定删除此方案吗？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => { deleteProject(project.id); message.success('已删除'); }}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} className="h-6 px-1" style={{ color: C.error }} />
                  </Popconfirm>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 保存弹窗 */}
      <Modal title="保存方案" open={!!saveName} onOk={confirmSave} onCancel={() => setSaveName('')} okText="保存" cancelText="取消">
        <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="输入方案名称" className="rounded-lg" />
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        title="重命名方案"
        open={renameModal.visible}
        okText="确定"
        cancelText="取消"
        onOk={() => { renameProject(renameModal.id, renameModal.name); setRenameModal({ visible: false, id: '', name: '' }); message.success('重命名成功'); }}
        onCancel={() => setRenameModal({ visible: false, id: '', name: '' })}
      >
        <Input value={renameModal.name} onChange={(e) => setRenameModal({ ...renameModal, name: e.target.value })} placeholder="输入方案名称" className="rounded-lg" />
      </Modal>
    </div>
  );
}

// ==================== 版本对比 ====================
function DiffPanel() {
  const viewMode = useStore((state) => state.viewMode);
  const diffResult = useStore((state) => state.diffResult);
  const diffProjectId = useStore((state) => state.diffProjectId);
  const exitCompare = useStore((state) => state.exitCompare);

  if (viewMode !== 'diff' || !diffResult) {
    return (
      <div className="py-8 text-center">
        <Empty description="选择两个方案进行对比" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        <p className="text-[11px] mt-2" style={{ color: C.text2 }}>
          在「存储方案」中使用对比按钮开始对比
        </p>
      </div>
    );
  }

  const cards = [
    { label: '新增', n: diffResult.totalAdded, bg: C.successSoft, color: C.success, icon: <ArrowUpOutlined /> },
    { label: '删除', n: diffResult.totalRemoved, bg: C.errorSoft, color: C.error, icon: <ArrowDownOutlined /> },
    { label: '变化', n: diffResult.totalChanged, bg: C.warnSoft, color: '#CA9A00', icon: null },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl p-2.5 text-center" style={{ background: c.bg }}>
            <div className="text-lg font-bold" style={{ color: c.color }}>
              {c.icon} {c.n}
            </div>
            <div className="text-[11px]" style={{ color: c.color }}>{c.label}</div>
          </div>
        ))}
      </div>

      {diffResult.addedParts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5"><Tag color="green">新增</Tag><span className="text-[11px]" style={{ color: C.text2 }}>{diffResult.addedParts.length} 种</span></div>
          <div className="space-y-1">
            {diffResult.addedParts.map((item, i) => (
              <div key={i} className="rounded-lg px-2 py-1.5 flex items-center justify-between" style={{ background: C.successSoft }}>
                <span className="text-[13px]" style={{ color: C.text }}>{item.partName}</span>
                <span className="text-[13px] font-bold" style={{ color: C.success }}>+{item.change}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diffResult.removedParts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5"><Tag color="red">删除</Tag><span className="text-[11px]" style={{ color: C.text2 }}>{diffResult.removedParts.length} 种</span></div>
          <div className="space-y-1">
            {diffResult.removedParts.map((item, i) => (
              <div key={i} className="rounded-lg px-2 py-1.5 flex items-center justify-between" style={{ background: C.errorSoft }}>
                <span className="text-[13px] line-through" style={{ color: C.text }}>{item.partName}</span>
                <span className="text-[13px] font-bold" style={{ color: C.error }}>{item.change}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diffResult.changedParts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5"><Tag color="gold">数量变化</Tag><span className="text-[11px]" style={{ color: C.text2 }}>{diffResult.changedParts.length} 种</span></div>
          <div className="space-y-1">
            {diffResult.changedParts.map((item, i) => (
              <div key={i} className="rounded-lg px-2 py-1.5 flex items-center justify-between" style={{ background: C.warnSoft }}>
                <span className="text-[13px]" style={{ color: C.text }}>{item.partName}</span>
                <span className="text-[11px]" style={{ color: C.text2 }}>{item.oldCount} → {item.newCount}</span>
                <span className="text-[13px] font-bold" style={{ color: item.change > 0 ? C.success : C.error }}>{item.change > 0 ? '+' : ''}{item.change}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diffResult.addedParts.length === 0 && diffResult.removedParts.length === 0 && diffResult.changedParts.length === 0 && (
        <div className="text-center py-4" style={{ color: C.text2 }}>两个方案完全相同</div>
      )}
    </div>
  );
}

// ==================== 右侧功能菜单面板（壳） ====================
interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

type SectionKey = 'parts' | 'save' | 'stats';

const RAIL_ITEMS: { key: SectionKey; icon: React.ReactNode; label: string; presetSub?: 'basic' | 'preset' | 'ext' }[] = [
  { key: 'parts', icon: <AppstoreOutlined />, label: '配件库', presetSub: 'basic' },
  { key: 'parts', icon: <LayoutOutlined />, label: '基本模块', presetSub: 'preset' },
  { key: 'parts', icon: <StarOutlined />, label: '扩展配件', presetSub: 'ext' },
  { key: 'save', icon: <FolderOpenOutlined />, label: '存储方案' },
  { key: 'stats', icon: <BarChartOutlined />, label: '统计信息' },
];

export function RightPanel({ collapsed, onToggle }: RightPanelProps) {
  const [active, setActive] = useState<SectionKey>('parts');
  const [presetSub, setPresetSub] = useState<'basic' | 'preset' | 'ext'>(
    'basic',
  );
  const viewMode = useStore((state) => state.viewMode);
  const exitCompare = useStore((state) => state.exitCompare);
  const diffActive = viewMode === 'diff';

  const openSection = (key: SectionKey, sub?: 'basic' | 'preset' | 'ext') => {
    if (sub) setPresetSub(sub);
    setActive(key);
    if (collapsed) onToggle();
  };

  const title = diffActive
    ? { icon: <DiffOutlined />, label: '版本对比' }
    : active === 'save'
      ? { icon: <FolderOpenOutlined />, label: '存储方案' }
      : active === 'stats'
        ? { icon: <BarChartOutlined />, label: '统计信息' }
        : { icon: <AppstoreOutlined />, label: '配件库' };

  // 展开面板主体内容
  let body: React.ReactNode = null;
  if (diffActive) {
    body = <DiffPanel />;
  } else if (active === 'save') {
    body = <ProjectsPanel />;
  } else if (active === 'stats') {
    body = <PartsSummary />;
  } else {
    body =
      presetSub === 'basic' ? (
        <BasicPartsGrid />
      ) : presetSub === 'preset' ? (
        <PresetsPanel />
      ) : (
        <ExtensionPartsGrid />
      );
  }

  return (
    <aside
      className={`designer-sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-label="配件和方案管理"
    >
      <nav className="designer-sidebar-tabs" aria-label="侧栏功能">
        {RAIL_ITEMS.map((item, index) => {
          const isActive =
            !diffActive &&
            active === item.key &&
            (item.presetSub ? presetSub === item.presetSub : true);
          return (
            <Tooltip
              key={`${item.key}-${item.presetSub || index}`}
              title={collapsed ? item.label : undefined}
            >
              <button
                onClick={() => openSection(item.key, item.presetSub)}
                aria-label={item.label}
                aria-pressed={isActive}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span className="designer-tab-label">{item.label}</span>
              </button>
            </Tooltip>
          );
        })}
        {collapsed && (
          <button onClick={onToggle} aria-label="展开面板">
            <LeftOutlined />
          </button>
        )}
      </nav>
      {!collapsed && (
        <>
          <div className="designer-panel-header">
            <h2>
              {diffActive
                ? title.label
                : active === 'parts'
                  ? presetSub === 'basic'
                    ? '挑选你的配件'
                    : presetSub === 'preset'
                      ? '基本模块'
                      : '扩展配件'
                  : title.label}
            </h2>
            <div>
              {diffActive ? (
                <button onClick={exitCompare}>
                  <CloseOutlined />
                  退出对比
                </button>
              ) : (
                <button onClick={() => setActive('save')}>
                  <DiffOutlined />
                  对比
                </button>
              )}
              <button onClick={onToggle} aria-label="收起面板" title="收起面板">
                <DoubleRightOutlined />
              </button>
            </div>
          </div>
          <div className="designer-panel-body" data-testid="right-panel">
            {body}
          </div>
          <div className="designer-panel-footer">
            <AppstoreOutlined />
            点击配件，再点击场景地面放置
          </div>
        </>
      )}
    </aside>
  );
}
