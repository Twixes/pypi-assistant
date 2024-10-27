import fetch, { FormData } from 'node-fetch'
import wretch from 'wretch'

wretch.polyfills({ fetch, FormData })
