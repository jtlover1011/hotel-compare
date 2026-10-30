/* ===================================================
   平台清单 & 深链规则
   ---------------------------------------------------
   precise: 能把「酒店名 + 日期 + 人数」直接带进搜索结果
   其它平台只能打开酒店频道，由用户粘贴关键词（点「打开」会自动复制）
   =================================================== */

(function () {
  const enc = encodeURIComponent;

  window.HPC_PLATFORMS = [
    {
      id: 'ctrip',
      name: '携程',
      short: '携',
      brand: '#287DFA',
      region: '国内',
      hint: '国内主站，报价含税',
      precise: (c) => !!c.cityId,
      link: (c) => c.cityId
        ? `https://hotels.ctrip.com/hotels/list?flexType=1&cityId=${c.cityId}&provinceId=0&districtId=0&countryId=1&checkin=${c.checkin}&checkout=${c.checkout}`
        : 'https://m.ctrip.com/webapp/hotel/'
    },
    {
      id: 'meituan',
      name: '美团',
      short: '美',
      brand: '#FFC300',
      ink: '#3d2c00',
      region: '国内',
      hint: '本地酒店常有独家低价',
      precise: () => false,
      link: () => 'https://i.meituan.com/hotel/'
    },
    {
      id: 'fliggy',
      name: '飞猪',
      short: '飞',
      brand: '#FF6A00',
      region: '国内',
      hint: '阿里系，信用住/套餐多',
      precise: () => false,
      link: () => 'https://www.fliggy.com/hotel/'
    },
    {
      id: 'qunar',
      name: '去哪儿',
      short: '去',
      brand: '#00B4FF',
      region: '国内',
      hint: '聚合报价，便宜但需看渠道',
      precise: () => false,
      link: () => 'https://touch.qunar.com/hotel/'
    },
    {
      id: 'tongcheng',
      name: '同程',
      short: '同',
      brand: '#FF7700',
      region: '国内',
      hint: '低星/经济型覆盖好',
      precise: () => false,
      link: () => 'https://www.ly.com/hotel/'
    },
    {
      id: 'booking',
      name: 'Booking.com',
      short: 'B',
      brand: '#003580',
      region: '海外',
      hint: '海外房源最全，含税口径需注意',
      precise: () => true,
      link: (c) => 'https://www.booking.com/searchresults.zh-cn.html'
        + `?ss=${enc(c.keyword)}`
        + `&checkin=${c.checkin}&checkout=${c.checkout}`
        + `&group_adults=${c.adults}&no_rooms=${c.rooms}&group_children=${c.children}`
        + '&selected_currency=CNY&lang=zh-cn'
    },
    {
      id: 'agoda',
      name: 'Agoda',
      short: 'A',
      brand: '#5C2D91',
      region: '海外',
      hint: '东南亚价格常最低',
      precise: () => true,
      link: (c) => 'https://www.agoda.com/zh-cn/search'
        + `?textToSearch=${enc(c.keyword)}`
        + `&checkIn=${c.checkin}&los=${c.nights}`
        + `&adults=${c.adults}&rooms=${c.rooms}&children=${c.children}`
        + '&currency=CNY'
    },
    {
      id: 'trip',
      name: 'Trip.com',
      short: 'T',
      brand: '#2577E3',
      region: '海外',
      hint: '携程国际版，英文客群价',
      precise: () => false,
      link: (c) => 'https://www.trip.com/hotels/list'
        + `?checkin=${c.checkin}&checkout=${c.checkout}`
        + `&adult=${c.adults}&children=${c.children}&rooms=${c.rooms}`
    },
    {
      id: 'expedia',
      name: 'Expedia',
      short: 'E',
      brand: '#00355F',
      region: '海外',
      hint: '机+酒打包更划算',
      precise: () => true,
      link: (c) => 'https://www.expedia.com/Hotel-Search'
        + `?destination=${enc(c.keyword)}`
        + `&startDate=${c.checkin}&endDate=${c.checkout}`
        + `&adults=${c.adults}&rooms=${c.rooms}`
    },
    {
      id: 'hotels',
      name: 'Hotels.com',
      short: 'H',
      brand: '#D32F2F',
      region: '海外',
      hint: '住十晚送一晚',
      precise: () => true,
      link: (c) => 'https://www.hotels.com/Hotel-Search'
        + `?destination=${enc(c.keyword)}`
        + `&startDate=${c.checkin}&endDate=${c.checkout}`
        + `&adults=${c.adults}&rooms=${c.rooms}`
    },
    {
      id: 'airbnb',
      name: 'Airbnb',
      short: 'ab',
      brand: '#FF5A5F',
      region: '民宿',
      hint: '整租/民宿，适合多人',
      precise: () => true,
      link: (c) => `https://www.airbnb.cn/s/${enc(c.keyword)}/homes`
        + `?checkin=${c.checkin}&checkout=${c.checkout}`
        + `&adults=${c.adults}&children=${c.children}`
    }
  ];

  /* 携程城市 ID：仅在确认过的城市上给快捷按钮 */
  window.HPC_CITIES = [
    { name: '北京', id: 1 },
    { name: '上海', id: 2 },
    { name: '广州', id: 32 },
    { name: '深圳', id: 30 }
  ];
})();
