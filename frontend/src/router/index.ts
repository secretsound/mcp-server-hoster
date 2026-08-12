import { createRouter, createWebHistory } from "vue-router";
import AppLayout from "../layouts/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const router = createRouter({
  history: createWebHistory("/ui/"),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("../views/LoginView.vue"),
      meta: { public: true },
    },
    {
      path: "/oauth/callback",
      name: "oauth-callback",
      component: () => import("../views/OAuthCallbackView.vue"),
      meta: { public: true },
    },
    {
      path: "/oauth/consent",
      name: "mcp-consent",
      component: () => import("../views/McpConsentView.vue"),
      meta: { public: true },
    },
    {
      path: "/invite/:token",
      name: "invite",
      component: () => import("../views/InviteAcceptView.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      component: AppLayout,
      children: [
        {
          path: "",
          name: "servers",
          component: () => import("../views/ServersView.vue"),
        },
        {
          path: "servers/:id",
          name: "server-detail",
          component: () => import("../views/ServerDetailView.vue"),
        },
        {
          path: "library",
          name: "library",
          component: () => import("../views/LibraryView.vue"),
          meta: { permission: "servers:read" },
        },
        {
          path: "store",
          redirect: { name: "library" },
        },
        {
          path: "connect",
          name: "connect",
          component: () => import("../views/ConnectView.vue"),
        },
        {
          path: "api",
          name: "api",
          component: () => import("../views/ApiLabView.vue"),
          meta: { permission: "servers:read" },
        },
        {
          path: "profile",
          name: "profile",
          component: () => import("../views/ProfileView.vue"),
        },
        {
          path: "keys",
          name: "keys",
          component: () => import("../views/KeysView.vue"),
        },
        {
          path: "users",
          name: "users",
          component: () => import("../views/UsersView.vue"),
          meta: { permission: "users:read" },
        },
        {
          path: "invites",
          name: "invites",
          component: () => import("../views/InvitesView.vue"),
          meta: { permission: "invites:write" },
        },
        {
          path: "roles",
          name: "roles",
          component: () => import("../views/RolesView.vue"),
          meta: { permission: "roles:read" },
        },
        {
          path: "audit",
          name: "audit",
          component: () => import("../views/AuditView.vue"),
          meta: { permission: "audit:read" },
        },
        {
          path: "settings",
          name: "settings",
          component: () => import("../views/SettingsView.vue"),
          meta: { permission: "settings:read" },
        },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) {
    try {
      await auth.hydrate();
    } catch {
      /* allow navigation; pages surface errors */
    }
  }

  if (to.meta.public) {
    if (auth.isAuthenticated && to.name === "login") {
      const redirect = typeof to.query.redirect === "string"
        ? to.query.redirect
        : "/";
      return redirect.startsWith("/") ? redirect : "/";
    }
    if (auth.isAuthenticated && to.name === "oauth-callback") {
      return { path: "/" };
    }
    return true;
  }

  if (auth.needsLogin) {
    return {
      name: "login",
      query: { redirect: to.fullPath },
    };
  }

  const permission = to.meta.permission as string | undefined;
  if (permission && auth.required && !auth.can(permission)) {
    return { name: "keys" };
  }

  return true;
});

export default router;
