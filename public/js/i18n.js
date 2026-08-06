/* Portal display language (Settings → Time and language).
 *
 * The portal's UI is authored in English; this layer translates the visible
 * chrome — navigation, section titles, common actions, settings labels — by
 * exact string match, on load and again whenever the SPA re-renders (the
 * portal repaints whole subtrees, so a MutationObserver is the only hook that
 * catches everything). Dynamic sentences with names and numbers in them stay
 * in English until they get proper translations; that is honest, visible
 * progress rather than a half-translated fake.
 *
 * English costs nothing: no observer, no walking, the file returns
 * immediately. Only languages with a shipped dictionary are offered in the
 * settings picker — a language that changed nothing would read as broken.
 */
(function () {
  'use strict';

  if (window.TMAI18n) return;

  var lang = '';
  try { lang = localStorage.getItem('tma.language') || 'en'; } catch (e) { lang = 'en'; }

  var DICTS = {
    es: {
      'Dashboard': 'Panel', 'Home': 'Inicio', 'Overview': 'Resumen', 'Email': 'Correo',
      'Calendar': 'Calendario', 'Messages': 'Mensajes', 'Chat': 'Chat', 'Feed': 'Novedades',
      'People': 'Personas', 'Users': 'Usuarios', 'Client hub': 'Centro de clientes',
      'Clients': 'Clientes', 'Projects': 'Proyectos', 'My Projects': 'Mis proyectos',
      'File Library': 'Biblioteca de archivos', 'Signatures': 'Firmas', 'Templates': 'Plantillas',
      'Workflows': 'Flujos de trabajo', 'Settings': 'Configuración', 'Search': 'Buscar',
      'Profile': 'Perfil', 'Today': 'Hoy', 'Alerts': 'Alertas', 'Notifications': 'Notificaciones',
      'Save': 'Guardar', 'Cancel': 'Cancelar', 'Delete': 'Eliminar', 'Edit': 'Editar',
      'Close': 'Cerrar', 'Back': 'Atrás', 'Next': 'Siguiente', 'Continue': 'Continuar',
      'Done': 'Listo', 'Open': 'Abrir', 'Add': 'Añadir', 'Create': 'Crear', 'Upload': 'Subir',
      'Download': 'Descargar', 'Share': 'Compartir', 'Rename': 'Renombrar', 'Move': 'Mover',
      'Copy': 'Copiar', 'Remove': 'Quitar', 'Send': 'Enviar', 'Loading…': 'Cargando…',
      'All Files': 'Todos los archivos', 'My Files': 'Mis archivos',
      'Shared with me': 'Compartido conmigo', 'Shared folders': 'Carpetas compartidas',
      'Recent': 'Recientes', 'Favorites': 'Favoritos', 'File Box': 'Buzón de archivos',
      'Recycle bin': 'Papelera', 'New folder': 'Nueva carpeta', 'Folders': 'Carpetas',
      'Files': 'Archivos', 'Name': 'Nombre', 'Size': 'Tamaño', 'Modified': 'Modificado',
      'Owner': 'Propietario',
      'My profile': 'Mi perfil', 'Theme': 'Tema', 'Time and language': 'Hora e idioma',
      'Privacy': 'Privacidad', 'Account security': 'Seguridad de la cuenta',
      'Connectors': 'Conectores', 'Storage': 'Almacenamiento', 'Usage': 'Uso',
      'Sign out': 'Cerrar sesión', 'Light': 'Claro', 'Dark': 'Oscuro', 'System': 'Sistema',
      'Font size': 'Tamaño de letra', 'Sidebar style': 'Estilo de barra lateral',
      'Language and Region': 'Idioma y región', 'Time Zone': 'Zona horaria',
      'Automatically set time zone': 'Establecer zona horaria automáticamente',
      'Email notifications': 'Notificaciones por correo',
      'Always send email notifications': 'Enviar siempre notificaciones por correo',
      'Connected': 'Conectado', 'Connect': 'Conectar', 'Disconnect': 'Desconectar',
      'Reconnect': 'Reconectar', 'Required': 'Obligatorio', 'Optional': 'Opcional',
      'Recommended': 'Recomendado', 'On': 'Activado', 'Off': 'Desactivado',
      'Enabled': 'Habilitado', 'Mark all as read': 'Marcar todo como leído',
      'No results': 'Sin resultados', 'Members': 'Miembros',
    },
    fr: {
      'Dashboard': 'Tableau de bord', 'Home': 'Accueil', 'Overview': 'Aperçu', 'Email': 'Courriel',
      'Calendar': 'Calendrier', 'Messages': 'Messages', 'Chat': 'Chat', 'Feed': 'Actualités',
      'People': 'Personnes', 'Users': 'Utilisateurs', 'Client hub': 'Espace clients',
      'Clients': 'Clients', 'Projects': 'Projets', 'My Projects': 'Mes projets',
      'File Library': 'Bibliothèque de fichiers', 'Signatures': 'Signatures', 'Templates': 'Modèles',
      'Workflows': 'Flux de travail', 'Settings': 'Paramètres', 'Search': 'Rechercher',
      'Profile': 'Profil', 'Today': "Aujourd'hui", 'Alerts': 'Alertes', 'Notifications': 'Notifications',
      'Save': 'Enregistrer', 'Cancel': 'Annuler', 'Delete': 'Supprimer', 'Edit': 'Modifier',
      'Close': 'Fermer', 'Back': 'Retour', 'Next': 'Suivant', 'Continue': 'Continuer',
      'Done': 'Terminé', 'Open': 'Ouvrir', 'Add': 'Ajouter', 'Create': 'Créer',
      'Upload': 'Téléverser', 'Download': 'Télécharger', 'Share': 'Partager',
      'Rename': 'Renommer', 'Move': 'Déplacer', 'Copy': 'Copier', 'Remove': 'Retirer',
      'Send': 'Envoyer', 'Loading…': 'Chargement…',
      'All Files': 'Tous les fichiers', 'My Files': 'Mes fichiers',
      'Shared with me': 'Partagé avec moi', 'Shared folders': 'Dossiers partagés',
      'Recent': 'Récents', 'Favorites': 'Favoris', 'File Box': 'Boîte de dépôt',
      'Recycle bin': 'Corbeille', 'New folder': 'Nouveau dossier', 'Folders': 'Dossiers',
      'Files': 'Fichiers', 'Name': 'Nom', 'Size': 'Taille', 'Modified': 'Modifié',
      'Owner': 'Propriétaire',
      'My profile': 'Mon profil', 'Theme': 'Thème', 'Time and language': 'Heure et langue',
      'Privacy': 'Confidentialité', 'Account security': 'Sécurité du compte',
      'Connectors': 'Connecteurs', 'Storage': 'Stockage', 'Usage': 'Utilisation',
      'Sign out': 'Se déconnecter', 'Light': 'Clair', 'Dark': 'Sombre', 'System': 'Système',
      'Font size': 'Taille du texte', 'Sidebar style': 'Style de la barre latérale',
      'Language and Region': 'Langue et région', 'Time Zone': 'Fuseau horaire',
      'Automatically set time zone': 'Définir le fuseau horaire automatiquement',
      'Email notifications': 'Notifications par courriel',
      'Always send email notifications': 'Toujours envoyer les notifications par courriel',
      'Connected': 'Connecté', 'Connect': 'Connecter', 'Disconnect': 'Déconnecter',
      'Reconnect': 'Reconnecter', 'Required': 'Obligatoire', 'Optional': 'Facultatif',
      'Recommended': 'Recommandé', 'On': 'Activé', 'Off': 'Désactivé',
      'Enabled': 'Activé', 'Mark all as read': 'Tout marquer comme lu',
      'No results': 'Aucun résultat', 'Members': 'Membres',
    },
    'zh-hans': {
      'Dashboard': '仪表板', 'Home': '主页', 'Overview': '概览', 'Email': '邮件',
      'Calendar': '日历', 'Messages': '消息', 'Chat': '聊天', 'Feed': '动态',
      'People': '人员', 'Users': '用户', 'Client hub': '客户中心',
      'Clients': '客户', 'Projects': '项目', 'My Projects': '我的项目',
      'File Library': '文件库', 'Signatures': '签名', 'Templates': '模板',
      'Workflows': '工作流', 'Settings': '设置', 'Search': '搜索',
      'Profile': '个人资料', 'Today': '今天', 'Alerts': '提醒', 'Notifications': '通知',
      'Save': '保存', 'Cancel': '取消', 'Delete': '删除', 'Edit': '编辑',
      'Close': '关闭', 'Back': '返回', 'Next': '下一步', 'Continue': '继续',
      'Done': '完成', 'Open': '打开', 'Add': '添加', 'Create': '创建', 'Upload': '上传',
      'Download': '下载', 'Share': '共享', 'Rename': '重命名', 'Move': '移动',
      'Copy': '复制', 'Remove': '移除', 'Send': '发送', 'Loading…': '加载中…',
      'All Files': '全部文件', 'My Files': '我的文件',
      'Shared with me': '与我共享', 'Shared folders': '共享文件夹',
      'Recent': '最近', 'Favorites': '收藏', 'File Box': '文件收件箱',
      'Recycle bin': '回收站', 'New folder': '新建文件夹', 'Folders': '文件夹',
      'Files': '文件', 'Name': '名称', 'Size': '大小', 'Modified': '修改时间',
      'Owner': '所有者',
      'My profile': '我的资料', 'Theme': '主题', 'Time and language': '时间与语言',
      'Privacy': '隐私', 'Account security': '账户安全',
      'Connectors': '连接器', 'Storage': '存储', 'Usage': '用量',
      'Sign out': '退出登录', 'Light': '浅色', 'Dark': '深色', 'System': '跟随系统',
      'Font size': '字号', 'Sidebar style': '侧边栏样式',
      'Language and Region': '语言与地区', 'Time Zone': '时区',
      'Automatically set time zone': '自动设置时区',
      'Email notifications': '邮件通知',
      'Always send email notifications': '始终发送邮件通知',
      'Connected': '已连接', 'Connect': '连接', 'Disconnect': '断开连接',
      'Reconnect': '重新连接', 'Required': '必需', 'Optional': '可选',
      'Recommended': '推荐', 'On': '开', 'Off': '关',
      'Enabled': '已启用', 'Mark all as read': '全部标为已读',
      'No results': '无结果', 'Members': '成员',
    },
  };

  var dict = DICTS[lang];

  window.TMAI18n = {
    lang: lang,
    available: ['en', 'es', 'fr', 'zh-hans'],
    t: function (s) { return (dict && dict[s]) || s; },
  };

  if (!dict) return; // English (or an unshipped language): zero cost.

  var ATTRS = ['placeholder', 'aria-label', 'title'];
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };

  function translateTextNode(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var trimmed = raw.trim();
    if (!trimmed) return;
    var out = dict[trimmed];
    if (out && out !== trimmed) {
      node.nodeValue = raw.replace(trimmed, out);
    }
  }

  function translate(rootEl) {
    if (!rootEl) return;
    if (rootEl.nodeType === 3) { translateTextNode(rootEl); return; }
    if (rootEl.nodeType !== 1 || SKIP[rootEl.nodeName]) return;

    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        return p && !SKIP[p.nodeName] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (var n = walker.nextNode(); n; n = walker.nextNode()) translateTextNode(n);

    var all = rootEl.querySelectorAll('[placeholder],[aria-label],[title]');
    for (var i = 0; i < all.length; i++) {
      for (var a = 0; a < ATTRS.length; a++) {
        var v = all[i].getAttribute(ATTRS[a]);
        if (v && dict[v]) all[i].setAttribute(ATTRS[a], dict[v]);
      }
    }
  }

  var pending = [];
  var timer = null;

  function flush() {
    timer = null;
    var batch = pending;
    pending = [];
    for (var i = 0; i < batch.length; i++) translate(batch[i]);
  }

  function boot() {
    translate(document.body);
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) pending.push(added[j]);
      }
      if (pending.length && !timer) timer = setTimeout(flush, 80);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
