'use client';

import { useState, useEffect } from 'react';
import { Tooltip, Button, Popover, message } from 'antd';
import {
  UndoOutlined,
  RedoOutlined,
  ApartmentOutlined,
  DownloadOutlined,
  BgColorsOutlined,
  BorderOutlined,
} from '@ant-design/icons';
import dynamic from 'next/dynamic';
import { Check, Cuboid, Save, Hand, Orbit, Focus, Paintbrush } from 'lucide-react';
import './workspace.css';
import { RightPanel } from '@/components/ui/RightPanel';
import WorkflowTab from '@/components/ui/WorkflowTab';
import { useStore } from '@/store/useStore';
import { PART_COLORS, getPartById } from '@/data/parts';


// 动态导入 3D 场景（避免 SSR 问题）
const Scene3D = dynamic(() => import('@/components/three/Scene3D'), {
  ssr: false,
});

// DESIGN.md 色彩
const C = {
  primary: '#4A90D9',
  bgSurfaceCont: '#EFF3F6',
  text: '#333333',
  text2: '#6B7280',
  line: '#E4E9EE',
};

export default function HomePage() {
  const selectedCount = useStore((state) => state.selectedIds.length);
  const projects = useStore((state) => state.projects);
  const currentProjectId = useStore((state) => state.currentProjectId);
  const currentProject = projects.find(
    (project) => project.id === currentProjectId,
  );
  const saveProject = useStore((state) => state.saveProject);
  const gizmoMode = useStore((s) => s.gizmoMode);
  const setGizmoMode = useStore((s) => s.setGizmoMode);
  const navMode = useStore((s) => s.navMode);
  const setNavMode = useStore((s) => s.setNavMode);
  const paintColor = useStore((s) => s.paintColor);
  const setPaintColor = useStore((s) => s.setPaintColor);
  const parts = useStore((s) => s.parts);
  const paintSelected = useStore((s) => s.paintSelected);
  const randomColorSelected = useStore((s) => s.randomColorSelected);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const exportJSON = useStore((s) => s.exportJSON);
  const workflow = useStore((s) => s.workflow);
  const setWorkflow = useStore((s) => s.setWorkflow);
  const generateFramework = useStore((s) => s.generateFramework);
  const [paintOpen, setPaintOpen] = useState(false);
  const [batchTool, setBatchTool] = useState<'junction' | 'bar' | 'platform' | null>(null);
  const [randomPalette, setRandomPalette] = useState<string[] | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [fwLayers, setFwLayers] = useState(3);
  const [fwCols, setFwCols] = useState(2);
  const [fwDepth, setFwDepth] = useState(2);
  const panelToggle = () => setPanelCollapsed((c) => !c);

  const closeToolMenus = () => {
    setPaintOpen(false);
    setBatchTool(null);
    setRandomPalette(null);
  };

  const runBatchColor = (category: 'bar' | 'platform', color: string | string[]) => {
    const state = useStore.getState();
    state.selectByCategory(category);
    if (typeof color === 'string') paintSelected(color);
    else randomColorSelected(color);
    setBatchTool(null);
    setRandomPalette(null);
  };

  const changeJunctions = (mode: 'six' | 'optimize') => {
    const state = useStore.getState();
    // Custom and nested fittings have purpose-built sockets outside this operation.
    const nested = new Set(state.groups
      .filter(group => group.memberIds.some(id => state.parts.some(part => part.id === id && part.partId === 'connector-45deg-nest')))
      .flatMap(group => group.memberIds));
    const ids = state.parts.filter(part =>
      getPartById(part.partId)?.connectorSpec
      && !part.partId.startsWith('connector-45') && part.partId !== 'connector-bazi' && !nested.has(part.id),
    ).map(part => part.id);
    if (!ids.length) {
      message.info('当前方案没有可批量调整的常规连接件。');
      return;
    }
    state.setSelection(ids, ids[0]);
    if (mode === 'six') state.replaceSelectedConnectors('connector-v6');
    else state.optimizeSelectedConnectors();
    setBatchTool(null);
  };
  const toggleView = (mode: 'pan' | 'rotate') => {
    closeToolMenus();
    setNavMode(navMode === mode ? 'none' : mode);
  };

  const activeToolHint = navMode === 'pan'
    ? '平移视角：按住左键拖动，移动观察位置。'
    : navMode === 'rotate'
      ? '环绕视角：按住左键拖动，从不同角度查看模型。'
      : paintColor ? '配件上色：点击杆件或平台板应用所选颜色。' : null;

  useEffect(() => {
    if (useStore.getState().projects.length === 0) {
      useStore.getState().loadProjects();
    }
  }, []);

  const handleExport = () => {
    if (exportJSON().trim() === '[]') return;
    const json = exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `攀爬架设计_${new Date().toLocaleDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="designer-app">
      {/* ===================== 顶部菜单区 ===================== */}
      <header className="designer-header">
        <div className="designer-brand">
          <span className="designer-brand-mark">
            <Cuboid size={26} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <div>
            <h1>攀爬架设计器</h1>
            <p>让每一个想法，都搭得起来。</p>
          </div>
        </div>
        <div className="designer-project-name">
          <span className="designer-status-dot" />
          {currentProject?.name || '未命名方案'}
        </div>
        <div className="designer-header-actions">
          <Button
            aria-label="保存方案"
            icon={<Save size={15} aria-hidden="true" />}
            onClick={() => {
              saveProject();
              message.success('方案已保存在当前浏览器');
            }}
          >
            保存方案
          </Button>
          <Button
            aria-label="导出 JSON"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            导出 JSON
          </Button>
        </div>
      </header>
      <div className="designer-toolbar">
        <WorkflowTab
          section="modes"
          suspended={!!activeToolHint}
          onActivate={() => {
            setNavMode('none');
            closeToolMenus();
          }}
          workflow={workflow}
          gizmoMode={gizmoMode}
          setWorkflow={setWorkflow}
          setGizmoMode={setGizmoMode}
          generateFramework={generateFramework}
          layers={fwLayers}
          setLayers={setFwLayers}
          cols={fwCols}
          setCols={setFwCols}
          depth={fwDepth}
          setDepth={setFwDepth}
          setPaintColor={setPaintColor}
        />
        <div className="designer-toolbar-tools">
          <div className="designer-tool-section">
            <span className="designer-tool-label">编辑</span>
            <div className="designer-edit-tools" role="group" aria-label="编辑">
              <div className="designer-tool-buttons" role="group" aria-label="历史">
                <Tooltip title="撤销 (Ctrl+Z)">
                  <button type="button" aria-label="撤销" onClick={undo}><UndoOutlined /></button>
                </Tooltip>
                <Tooltip title="重做 (Ctrl+Y)">
                  <button type="button" aria-label="重做" onClick={redo}><RedoOutlined /></button>
                </Tooltip>
              </div>
            <Popover
              trigger="click"
              open={paintOpen}
              onOpenChange={(open) => {
                setPaintOpen(open);
                if (open) setBatchTool(null);
              }}
              placement="bottom"
              content={
                <div className="w-60 p-2">
                  <div
                    className="text-[12px] font-semibold mb-2"
                    style={{ color: C.text }}
                  >
                    给杆件 / 平台板 上色
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PART_COLORS.map((c) => (
                      <button
                        key={c.id}
                        title={c.name}
                        onClick={() => {
                          setNavMode('none');
                          setPaintColor(c.id);
                          setBatchTool(null);
                          setPaintOpen(false);
                        }}
                        className="w-8 h-8 rounded-full cursor-pointer border transition-all"
                        style={{
                          background: c.hex,
                          borderColor: paintColor === c.id ? C.primary : C.line,
                          boxShadow:
                            paintColor === c.id
                              ? '0 0 0 2px rgba(74,144,217,0.4)'
                              : 'none',
                          transform:
                            paintColor === c.id ? 'scale(1.08)' : 'none',
                        }}
                      />
                    ))}
                  </div>
                  <div
                    className="text-[11px] mt-2 leading-relaxed"
                    style={{ color: C.text2 }}
                  >
                    选择颜色后，点击场景中的杆件或平台板即可直接染色。
                  </div>
                  {paintColor && (
                    <button
                      onClick={() => {
                        setPaintColor(null);
                        setPaintOpen(false);
                      }}
                      className="mt-2 w-full text-[12px] font-medium h-8 rounded-full transition-colors"
                      style={{
                        background: '#fff0f0',
                        color: '#D14B4B',
                        border: '1px solid #F5C6C6',
                      }}
                    >
                      退出上色模式
                    </button>
                  )}
                </div>
              }
            >
              <Tooltip title="油漆桶：选色后点按杆件/平台板直接上色">
                <button
                  aria-pressed={!!paintColor}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[13px] font-medium border transition-all"
                  style={
                    paintColor
                      ? {
                          background: 'rgba(74,144,217,0.12)',
                          color: C.primary,
                          borderColor: 'rgba(74,144,217,0.4)',
                        }
                      : {
                          background: '#fff',
                          color: C.text2,
                          borderColor: C.line,
                        }
                  }
                >
                  <BgColorsOutlined /> {paintColor ? '上色中' : '配件上色'}
                </button>
              </Tooltip>
            </Popover>

              <Popover
                trigger="click"
                open={batchTool === 'junction'}
                onOpenChange={open => {
                  setBatchTool(current => open ? 'junction' : current === 'junction' ? null : current);
                  if (open) setPaintOpen(false);
                }}
                placement="bottom"
                title="调整全部常规连接件"
                content={
                  <div className="designer-batch-menu">
                    <button type="button" onClick={() => changeJunctions('six')}>
                      <strong>全六通</strong><span>统一为六向连接件</span>
                    </button>
                    <button type="button" onClick={() => changeJunctions('optimize')}>
                      <strong>全优化</strong><span>根据现有接线精简接口</span>
                    </button>
                  </div>
                }
              >
                <button type="button" className="designer-edit-action" aria-expanded={batchTool === 'junction'}>
                  <ApartmentOutlined /> 接点优化
                </button>
              </Popover>
              {([
                { category: 'bar', label: '杆件批量上色', icon: <Paintbrush size={14} /> },
                { category: 'platform', label: '板件批量上色', icon: <BorderOutlined /> },
              ] as const).map(({ category, label, icon }) => {
                const count = parts.filter(part => getPartById(part.partId)?.category === category).length;
                return (
                  <Popover
                    key={category}
                    trigger="click"
                    open={batchTool === category}
                    onOpenChange={open => {
                      setBatchTool(current => open ? category : current === category ? null : current);
                      if (open) {
                        setPaintOpen(false);
                        setRandomPalette(null);
                      }
                    }}
                    placement="bottom"
                    title={`为 ${count} 件${category === 'bar' ? '杆件' : '板件'}上色`}
                    content={
                      <div className="designer-batch-colors">
                        {randomPalette && <p className="designer-batch-hint">勾选要参与随机上色的颜色</p>}
                        <div className="designer-batch-swatches" role="group" aria-label={randomPalette ? '随机上色色板' : '统一上色色板'}>
                          {PART_COLORS.map(color => {
                            const checked = randomPalette?.includes(color.id);
                            return (
                              <button key={color.id} type="button" title={color.name} aria-label={color.name}
                                aria-pressed={checked} disabled={!count} style={{ background: color.hex }}
                                onClick={() => {
                                  if (!randomPalette) runBatchColor(category, color.id);
                                  else setRandomPalette(current => current?.includes(color.id)
                                    ? current.filter(id => id !== color.id) : [...(current ?? []), color.id]);
                                }}>
                                {checked && <Check size={14} aria-hidden="true" />}
                              </button>
                            );
                          })}
                        </div>
                        <div className="designer-batch-actions">
                          {randomPalette ? <>
                            <Button size="small" onClick={() => setRandomPalette(null)}>返回</Button>
                            <Button size="small" type="primary" disabled={!count || !randomPalette.length}
                              onClick={() => runBatchColor(category, randomPalette)}>
                              随机上色{randomPalette.length > 0 ? `（${randomPalette.length} 色）` : ''}
                            </Button>
                          </> : <Button size="small" disabled={!count} onClick={() => setRandomPalette([])}>随机上色</Button>}
                        </div>
                      </div>
                    }
                  >
                    <button type="button" className="designer-edit-action" aria-label={label} aria-expanded={batchTool === category}>
                      {icon} {label}
                    </button>
                  </Popover>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {activeToolHint && (
        <div className="designer-tool-status">
          <span role="status">{activeToolHint}</span>
          <button type="button" onClick={() => {
            setNavMode('none');
            setPaintColor(null);
            closeToolMenus();
          }}>返回搭建</button>
        </div>
      )}
      {/* ===================== 主体 ===================== */}
      <div className="designer-main">
        {/* 工作区：3D 场景 */}
        <main className="designer-stage" aria-label="3D 搭建工作区">
          <Scene3D />
          {/* 左上角快捷工作选项卡 */}
          <WorkflowTab
            section="parameters"
            workflow={workflow}
            gizmoMode={gizmoMode}
            setWorkflow={setWorkflow}
            setGizmoMode={setGizmoMode}
            generateFramework={generateFramework}
            layers={fwLayers}
            setLayers={setFwLayers}
            cols={fwCols}
            setCols={setFwCols}
            depth={fwDepth}
            setDepth={setFwDepth}
            setPaintColor={setPaintColor}
          />
          <div className="designer-view-dock" role="group" aria-label="视角">
            <Tooltip title="平移视角">
              <button type="button" aria-label="移动视角" aria-pressed={navMode === 'pan'} onClick={() => toggleView('pan')}>
                <Hand size={19} aria-hidden="true" /><span>平移</span>
              </button>
            </Tooltip>
            <Tooltip title="环绕观察模型">
              <button type="button" aria-label="旋转视角" aria-pressed={navMode === 'rotate'} onClick={() => toggleView('rotate')}>
                <Orbit size={20} aria-hidden="true" /><span>环绕</span>
              </button>
            </Tooltip>
            <Tooltip title="居中模型并重置视角">
              <button type="button" aria-label="居中模型" onClick={() => window.dispatchEvent(new CustomEvent('gizmo-reset-camera'))}>
                <Focus size={20} aria-hidden="true" /><span>居中</span>
              </button>
            </Tooltip>
          </div>
          <div className="designer-scene-hint">
            {parts.length === 0
              ? '设置框架尺寸，开始你的搭建。'
              : '点击选择 · 中键旋转 · 滚轮缩放'}
          </div>
        </main>

        {/* 右侧功能菜单面板 */}
        <RightPanel collapsed={panelCollapsed} onToggle={panelToggle} />
      </div>
      <footer className="designer-footer">
        <span>
          <span className="designer-status-dot" />
          {parts.length} 件配件
          <span className="designer-footer-divider" />
          已选中 {selectedCount} 件
        </span>
        <span>单位 cm · 网格 10 cm</span>
        <span>方案保存在当前浏览器</span>
      </footer>
    </div>
  );
}
