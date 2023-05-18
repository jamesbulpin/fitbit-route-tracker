registerSettingsPage(({ settings }) => (
  <Page>
    <Section
      title={
        <Text bold align="center">
          Route Tracker Settings
        </Text>
      }
    >
      <Text id="foo">Hello world!</Text>
      <Select
        label="Pace - minutes/km"
        settingsKey="pace"
        options={[
          {name:"10"},
          {name:"10.25"},
          {name:"10.5"},
          {name:"11"},
          {name:"11.5"},
          {name:"12"},
          {name:"13"},
          {name:"14"},
          {name:"15"},
          {name:"16"},
          {name:"17"},
          {name:"18"},
          {name:"19"},
          {name:"20"},
          {name:"25"},
          {name:"30"}
        ]}
      />
    </Section>
  </Page>
));
