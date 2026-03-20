import { createRouter, createWebHistory } from 'vue-router'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import HomePage from '@/pages/HomePage.vue'
import MetaPage from '@/pages/MetaPage.vue'
import HeroDetailPage from '@/pages/HeroDetailPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/meta', name: 'meta', component: MetaPage },
    { path: '/hero/:heroSlug', name: 'hero', component: HeroDetailPage },
  ],
})

router.beforeEach((to) => {
  const store = usePlayerFilterStore()
  const players = to.query.players
  if (typeof players === 'string') {
    store.setFromQuery(players.split(',').map((s) => s.trim()).filter(Boolean))
  }
})

export default router
