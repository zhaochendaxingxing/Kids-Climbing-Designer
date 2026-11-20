'use client';

import { Tooltip } from 'antd';
import type { ReactNode } from 'react';
import {
  AppstoreOutlined,
  DragOutlined,
  BorderOutlined,
  ArrowsAltOutlined,
} from '@ant-design/icons';

const C = {
  primary: '#4A90D9',
  text: '#333333',
  text2: '#6B7280',
  line: '#E4E9EE',
  bgSurfaceCont: '#EFF3F6',
};

const STEPS = [
  {
    key: 'spec',
    name: '生成框架',
    icon: <AppstoreOutlined />,
    desc: '输入 层高/列深 自动生成基础框架',
  },
  {
    key: 'frame',
    name: '编辑框架',
    icon: <DragOutlined />,
    desc: '延伸框架或替换杆件、连接件',
  },
  {
    key: 'accessory',
    name: '编辑平台板',
    icon: <BorderOutlined />,
    desc: '为框格铺板或替换同类配件',
  },
  {
    key: 'move',
    name: '移动配件',
    icon: <ArrowsAltOutlined />,
    desc: '选中物件显示操作轴，可自由移动/旋转编辑',
  },
] as const;

type StepKey = 'spec' | 'frame' | 'accessory' | 'move';

interface Props {
  section?: 'modes' | 'parameters';
  onActivate?: () => void;
  suspended?: boolean;
  workflow: 'spec' | 'frame' | 'accessory';
  gizmoMode: 'move' | 'growth';
  setWorkflow: (w: 'spec' | 'frame' | 'accessory') => void;
  setGizmoMode: (m: 'move' | 'growth') => void;
  generateFramework: (layers: number, cols: number, depth: number) => void;
  layers: number;
  setLayers: (n: number) => void;
  cols: number;
  setCols: (n: number) => void;
  depth: number;
  setDepth: (n: number) => void;
  setPaintColor: (c: string | null) => void;
}

export default function WorkflowTab({
  section,
  onActivate,
  suspended,
  workflow,
  gizmoMode,
  setWorkflow,
  setGizmoMode,
  generateFramework,
  layers,
  setLayers,
  cols,
  setCols,
  depth,
  setDepth,
  setPaintColor,
}: Props) {
  const handleStepClick = (key: StepKey) => {
    onActivate?.();
    setPaintColor(null);
    if (key === 'spec') {
      setWorkflow('spec');
      setGizmoMode('growth');
    } else if (key === 'frame') {
      setWorkflow('frame');
      setGizmoMode('growth');
    } else if (key === 'accessory') {
      setWorkflow('accessory');
      setGizmoMode('growth');
    } else if (key === 'move') {
      setGizmoMode('move');
    }
  };

  const isActive = (key: StepKey) => {
    if (suspended) return false;
    if (key === 'move') return gizmoMode === 'move';
    return workflow === key && gizmoMode === 'growth';
  };
  const showDimensions = workflow === 'spec' && gizmoMode !== 'move';
  return (
    <div
      className={
        section === 'modes' ? 'designer-workflow' : `designer-parameters${showDimensions ? '' : ' designer-build-hint'}`
      }
    >
      {/* 四个工作模式切换 */}
      {section !== 'parameters' && (
        <div className="designer-tool-section designer-workflow-section">
        <span className="designer-tool-label">搭建模式</span>
        <div
          className="designer-mode-switch"
          role="group"
          aria-label="搭建工作模式"
        >
          {STEPS.map((s, index) => {
            const active = isActive(s.key);
            return (
              <Tooltip key={s.key} title={s.desc}>
                <button
                  aria-pressed={active}
                  aria-label={s.name}
                  onClick={() => handleStepClick(s.key)}
                  className="designer-step-button"
                >
                  <span className="designer-step-icon" aria-hidden="true">{s.icon}</span>
                  <span className="designer-step-copy">
                    <span className="designer-step-index">Step {index + 1}</span>
                    <span>{s.name}</span>
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
        </div>
      )}

      {/* 当前阶段操作区 */}
      {section !== 'modes' && (
        <div className="designer-parameter-body">
          <div className="designer-parameter-title">
            <strong>{showDimensions ? '框架尺寸' : '搭建提示'}</strong>
            {showDimensions ? (
              <span>每格 40 cm</span>
            ) : (
              <span className="designer-hint-mode">
                {gizmoMode === 'move' ? '移动配件' : workflow === 'frame' ? '编辑框架' : '编辑平台板'}
              </span>
            )}
          </div>
          {gizmoMode === 'move' ? (
            <ul className="designer-hint-actions">
              <HintAction button="left" action="移动或旋转">选中配件，拖动操作轴调整。</HintAction>
              <HintAction button="left" action="吸附新配件">从配件库选取，指向框架预览，点击确认放置。</HintAction>
            </ul>
          ) : workflow === 'spec' ? (
            <div className="designer-parameter-fields">
              <NumberField label="层数" value={layers} onChange={setLayers} />
              <NumberField label="列数" value={cols} onChange={setCols} />
              <NumberField label="纵深" value={depth} onChange={setDepth} />
              <button
                onClick={() => {
                  generateFramework(layers, cols, depth);
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() =>
                      window.dispatchEvent(
                        new CustomEvent('gizmo-reset-camera'),
                      ),
                    ),
                  );
                }}
                className="h-9 px-4 rounded-xl text-[12px] font-semibold text-white shrink-0 transition-all hover:opacity-90"
                style={{ background: '#FF9F43', color: '#283544' }}
              >
                生成框架
              </button>
            </div>
          ) : (
            <ul className="designer-hint-actions">
              {workflow === 'frame' ? (
                <>
                  <HintAction button="left" action="生长延伸">选中杆件或连接件，在端点继续搭建。</HintAction>
                  <HintAction button="right" action="替换同类配件">打开杆件或连接件的替换列表。</HintAction>
                </>
              ) : (
                <>
                  <HintAction button="left" action="自动铺板">点击空框格，铺上匹配的基础平台板或三角屋面板。</HintAction>
                  <HintAction button="right" action="替换同类配件">点击基础平台板，打开替换列表。</HintAction>
                </>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function HintAction({ button, action, children }: {
  button: 'left' | 'right';
  action: string;
  children: ReactNode;
}) {
  return (
    <li data-button={button}>
      <span className="designer-hint-button">
        <i aria-hidden="true" />
        {button === 'left' ? '左键' : '右键'}
      </span>
      <div>
        <strong>{action}</strong>
        <p>{children}</p>
      </div>
    </li>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col">
      <span
        className="text-[10px] mb-0.5 font-medium"
        style={{ color: C.text2 }}
      >
        {label}
      </span>
      <input
        name={label}
        aria-label={label}
        type="number"
        min={1}
        max={20}
        value={value}
        onChange={(e) =>
          onChange(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))
        }
        className="w-14 h-9 rounded-lg border text-center text-[13px] font-semibold outline-none focus:ring-2 transition-all"
        style={{ borderColor: C.line, color: C.text, background: '#fff' }}
      />
    </label>
  );
}
