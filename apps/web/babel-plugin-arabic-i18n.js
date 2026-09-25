/**
 * إضافة Babel: تلف كل نص عربي في الواجهة بدالة ترجمة — دون تعديل الصفحات يدوياً.
 *
 *   'مرحبا'            → __t('مرحبا')
 *   `لديك ${n} موعد`   → __tf('لديك {0} موعد', [n])
 *   <p>المرضى</p>      → <p>{__t('المرضى')}</p>
 *   placeholder="ابحث" → placeholder={__t('ابحث')}
 *
 * لا تُلمس النصوص التي هي «بيانات» وليست واجهة:
 *  - مفاتيح الكائنات، والمقارنات (=== / !== / case)، ومعاملات includes/startsWith/split…
 *  - خصائص JSX: value / key / id / name / type / href / dir / lang / data-*
 *  - أي تعريف يسبقه تعليق `i18n-ignore` (مثل أسماء الوجبات المخزنة في القاعدة)
 *  - ملفات القاموس نفسها
 *
 * خيار collect: مجموعة (Set) تُجمع فيها المفاتيح — يستعملها سكربت استخراج النصوص وفحص التغطية.
 */
const AR = /[\u0600-\u06FF]/;
const SKIP_ATTRS = new Set(['value', 'key', 'id', 'name', 'type', 'href', 'dir', 'lang', 'className', 'htmlFor', 'form', 'role', 'defaultValue']);
const SKIP_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split', 'replace', 'replaceAll', 'match', 'localeCompare', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll', 'has', 'get', 'set', 'delete', 'test']);
const COMPARE = new Set(['===', '!==', '==', '!=', 'in']);

/** قواعد JSX للمسافات: السطور الجديدة تُحذف مع ما حولها، والمسافة داخل السطر تبقى */
export function cleanJsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return { lead: raw.match(/^\s*/)[0], core: raw.trim(), trail: raw.match(/\s*$/)[0] };
  const parts = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, ' ');
    if (i !== 0) l = l.replace(/^[ ]+/, '');
    if (i !== lines.length - 1) l = l.replace(/[ ]+$/, '');
    if (l) parts.push(l);
  });
  const joined = parts.join(' ');
  return { lead: joined.match(/^\s*/)[0], core: joined.trim(), trail: joined.match(/\s*$/)[0] };
}

function hasIgnoreComment(path) {
  let p = path;
  while (p) {
    const nodes = [p.node, p.parentPath?.isExportNamedDeclaration?.() ? p.parentPath.node : null].filter(Boolean);
    for (const n of nodes) {
      if ((n.leadingComments || []).some((c) => c.value.includes('i18n-ignore'))) return true;
    }
    if (p.isProgram?.()) break;
    p = p.parentPath;
  }
  return false;
}

function isDataContext(path) {
  const parent = path.parentPath;
  const pn = parent.node;
  if (parent.isImportDeclaration() || parent.isExportAllDeclaration() || parent.isExportNamedDeclaration()) return true;
  if ((parent.isObjectProperty() || parent.isObjectMethod() || parent.isClassProperty()) && pn.key === path.node && !pn.computed) return true;
  if (parent.isMemberExpression() && pn.property === path.node) return true;
  if (parent.isBinaryExpression() && COMPARE.has(pn.operator)) return true;
  if (parent.isSwitchCase() && pn.test === path.node) return true;
  if (parent.isDirective() || parent.isDirectiveLiteral?.()) return true;
  if (parent.isCallExpression()) {
    const c = pn.callee;
    if (c.type === 'Identifier' && (c.name === '__t' || c.name === '__tf' || c.name === 'require')) return true;
    if (c.type === 'MemberExpression' && !c.computed && SKIP_METHODS.has(c.property.name)) return true;
  }
  if (parent.isJSXAttribute()) {
    const name = pn.name.type === 'JSXNamespacedName' ? pn.name.name.name : pn.name.name;
    if (SKIP_ATTRS.has(name) || name.startsWith('data-')) return true;
  }
  return false;
}

export default function arabicI18n({ types: t }, opts = {}) {
  const collect = opts.collect || null;
  const add = (s) => { if (collect) collect.add(s); };
  const call = (s) => { add(s); return t.callExpression(t.identifier('__t'), [t.stringLiteral(s)]); };

  return {
    name: 'arabic-i18n',
    visitor: {
      Program(path, state) {
        const f = (state.filename || '').replace(/\\/g, '/');
        state.skipFile = /\/i18n(\.js|\/)/.test(f) || !/\/src\//.test(f);
      },
      StringLiteral(path, state) {
        if (state.skipFile || !AR.test(path.node.value)) return;
        if (isDataContext(path) || hasIgnoreComment(path)) return;
        const s = path.node.value;
        if (path.parentPath.isJSXAttribute()) {
          path.replaceWith(t.jsxExpressionContainer(call(s)));
        } else {
          path.replaceWith(call(s));
        }
        path.skip();
      },
      TemplateLiteral(path, state) {
        if (state.skipFile) return;
        const { quasis, expressions } = path.node;
        if (!quasis.some((q) => AR.test(q.value.cooked ?? q.value.raw))) return;
        if (path.parentPath.isTaggedTemplateExpression()) return;
        if (isDataContext(path) || hasIgnoreComment(path)) return;
        let fmtStr = '';
        quasis.forEach((q, i) => {
          fmtStr += q.value.cooked ?? q.value.raw;
          if (i < expressions.length) fmtStr += `{${i}}`;
        });
        add(fmtStr);
        path.replaceWith(t.callExpression(t.identifier('__tf'), [t.stringLiteral(fmtStr), t.arrayExpression(expressions)]));
        path.skip();
      },
      JSXText(path, state) {
        if (state.skipFile || !AR.test(path.node.value)) return;
        if (hasIgnoreComment(path)) return;
        const { lead, core, trail } = cleanJsxText(path.node.value);
        if (!core) return;
        const nodes = [];
        if (lead) nodes.push(t.jsxText(lead));
        nodes.push(t.jsxExpressionContainer(call(core)));
        if (trail) nodes.push(t.jsxText(trail));
        path.replaceWithMultiple(nodes);
        path.skip();
      },
    },
  };
}
