/* Runtime autonome des pages du canevas (format .dc.html) hors de Claude Design.
   Gère : trous {{chemin}}, <sc-if>, <sc-for>, onClick/onInput/onSubmit, setState.
   Le DOM est mis à jour par morphdom, ce qui garde le focus et la saisie. */
(function () {
  'use strict';

  var TROU = /\{\{\s*([^}]*?)\s*\}\}/g;
  var TROU_SEUL = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/;

  function lire(portee, chemin) {
    if (chemin === 'true') return true;
    if (chemin === 'false') return false;
    if (chemin === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(chemin)) return Number(chemin);
    var q = chemin.match(/^(['"])(.*)\1$/);
    if (q) return q[2];
    var parts = chemin.split('.');
    var v = portee[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }

  function enTexte(v) {
    return v == null || typeof v === 'boolean' ? '' : String(v);
  }

  function interpoler(txt, portee) {
    return txt.replace(TROU, function (_, c) { return enTexte(lire(portee, c)); });
  }

  function DCLogic() {
    this.props = {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch, cb) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, p);
    if (cb) this.__rappels.push(cb);
    this.__planifier();
  };
  DCLogic.prototype.forceUpdate = function (cb) {
    if (cb) this.__rappels.push(cb);
    this.__planifier();
  };

  function demarrer(Classe) {
    var racine = document.getElementById('dc-root');
    var modele = document.getElementById('dc-tpl').content;
    var comp = new Classe();
    if (!comp.props) comp.props = {};
    if (!comp.state) comp.state = {};
    comp.__rappels = [];
    var gestionnaires = {};
    var compteur = 0;
    var prevu = false;

    function construire(source, portee, parent) {
      for (var n = source.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          parent.appendChild(document.createTextNode(n.data.indexOf('{{') < 0 ? n.data : interpoler(n.data, portee)));
          continue;
        }
        if (n.nodeType !== 1) continue;
        var nom = n.localName;
        if (nom === 'sc-if') {
          var m = (n.getAttribute('value') || '').match(TROU_SEUL);
          var cond = m ? lire(portee, m[1]) : n.getAttribute('value');
          if (cond) construire(n, portee, parent);
          continue;
        }
        if (nom === 'sc-for') {
          var ml = (n.getAttribute('list') || '').match(TROU_SEUL);
          var liste = ml ? lire(portee, ml[1]) : null;
          var as = n.getAttribute('as') || 'item';
          if (liste && liste.length) {
            for (var i = 0; i < liste.length; i++) {
              var p2 = Object.create(portee);
              p2[as] = liste[i];
              p2.$index = i;
              construire(n, p2, parent);
            }
          }
          continue;
        }
        var el = n.cloneNode(false);
        var attrs = Array.prototype.slice.call(n.attributes);
        for (var a = 0; a < attrs.length; a++) {
          var an = attrs[a].name, av = attrs[a].value;
          if (an.indexOf('hint-') === 0) { el.removeAttribute(an); continue; }
          if (av.indexOf('{{') < 0) continue;
          var seul = av.match(TROU_SEUL);
          if (an.length > 2 && an.indexOf('on') === 0 && seul) {
            el.removeAttribute(an);
            var fn = lire(portee, seul[1]);
            if (typeof fn === 'function') {
              var id = 'g' + (compteur++);
              gestionnaires[id] = fn;
              el.setAttribute('data-dc-' + an.slice(2), id);
            }
            continue;
          }
          if (seul) {
            var v = lire(portee, seul[1]);
            if (v === false || v == null) el.removeAttribute(an);
            else el.setAttribute(an, v === true ? '' : String(v));
          } else {
            el.setAttribute(an, interpoler(av, portee));
          }
        }
        construire(n, portee, el);
        if (nom === 'textarea' && el.hasAttribute('value')) el.textContent = el.getAttribute('value');
        parent.appendChild(el);
      }
    }

    function rendre() {
      prevu = false;
      gestionnaires = {};
      compteur = 0;
      var vals = comp.renderVals() || {};
      var neuf = document.createElement('div');
      construire(modele, vals, neuf);
      window.morphdom(racine, neuf, {
        childrenOnly: true,
        onBeforeElUpdated: function (de, vers) { return !de.isEqualNode(vers); }
      });
      var r = comp.__rappels; comp.__rappels = [];
      r.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    }

    comp.__planifier = function () {
      if (prevu) return;
      prevu = true;
      Promise.resolve().then(rendre);
    };

    ['click', 'input', 'submit', 'change'].forEach(function (type) {
      racine.addEventListener(type, function (ev) {
        var cle = 'data-dc-' + type;
        for (var el = ev.target; el && el !== racine; el = el.parentNode) {
          if (el.nodeType !== 1 || !el.hasAttribute(cle)) continue;
          var fn = gestionnaires[el.getAttribute(cle)];
          if (fn) {
            try { fn.call(comp, ev); } catch (e) { console.error(e); }
          }
          if (ev.cancelBubble) break;
        }
      });
    });

    rendre();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
    window.addEventListener('pagehide', function () {
      if (typeof comp.componentWillUnmount === 'function') comp.componentWillUnmount();
    });
  }

  window.DCLogic = DCLogic;
  window.DC = { demarrer: demarrer };
})();
