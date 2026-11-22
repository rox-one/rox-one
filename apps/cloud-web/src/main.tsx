import { render } from 'solid-js/web'

import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Не найден элемент #root')

render(() => <App />, root)
